import { fail, ok } from "@/lib/api";
import { conversationSelect, normalizeRelation } from "@/lib/conversations";
import { requireRole } from "@/lib/auth";
import { revisionRequestSchema } from "@/lib/validators";

type Params = { params: { conversationId: string } };
type ConversationJob = { title?: string | null } | { title?: string | null }[] | null;

export async function POST(request: Request, { params }: Params) {
  const auth = await requireRole(request, ["client"]);
  if (auth instanceof Response) return auth;

  const body = revisionRequestSchema.safeParse(await request.json());
  if (!body.success) return fail("Invalid revision payload", 422, body.error.flatten());

  const { data: conversation, error: conversationError } = await auth.adminClient
    .from("job_conversations")
    .select("id, job_id, application_id, client_id, professional_id, status, work_status, final_payment_made_at, job:jobs(title)")
    .eq("id", params.conversationId)
    .single();

  if (conversationError || !conversation) return fail("Conversation not found", 404, conversationError?.message);
  if (conversation.client_id !== auth.userId) return fail("Only the client can request a revision", 403);
  if (conversation.status !== "open") return fail("This conversation is not open", 409);
  if (!conversation.final_payment_made_at) return fail("Final payment is required before requesting a revision", 409);
  if (!["submitted", "revision_requested"].includes(conversation.work_status)) {
    return fail("This job is not ready for revision", 409);
  }

  const { data: updatedConversation, error: updateError } = await auth.adminClient
    .from("job_conversations")
    .update({
      work_status: "revision_requested",
      revision_requested_at: new Date().toISOString(),
      revision_note: body.data.note
    })
    .eq("id", conversation.id)
    .select(conversationSelect)
    .single();

  if (updateError || !updatedConversation) return fail("Could not request revision", 400, updateError?.message);

  const job = normalizeRelation(conversation.job as ConversationJob);
  const revisionMessage = body.data.note.trim();

  const { error: messageError } = await auth.adminClient.from("messages").insert({
    conversation_id: conversation.id,
    sender_id: conversation.client_id,
    receiver_id: conversation.professional_id,
    job_id: conversation.job_id,
    application_id: conversation.application_id,
    body: `Revision requested: ${revisionMessage}`
  });

  if (messageError) return fail("Revision was saved, but could not add it to the conversation", 400, messageError.message);

  await auth.adminClient.from("notifications").insert({
    user_id: conversation.professional_id,
    type: "revision_requested",
    title: "Revision requested",
    body: `The client requested a revision${job?.title ? ` for "${job.title}"` : ""}.`,
    data: {
      conversation_id: conversation.id,
      job_id: conversation.job_id,
      application_id: conversation.application_id
    },
    channel: "in_app"
  });

  return ok({ conversation: updatedConversation });
}
