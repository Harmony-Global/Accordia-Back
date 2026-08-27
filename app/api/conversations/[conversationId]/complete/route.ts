import { fail, ok } from "@/lib/api";
import { conversationSelect, normalizeRelation } from "@/lib/conversations";
import { requireRole } from "@/lib/auth";

type Params = { params: { conversationId: string } };
type ConversationJob = { title?: string | null } | { title?: string | null }[] | null;

export async function POST(request: Request, { params }: Params) {
  const auth = await requireRole(request, ["client"]);
  if (auth instanceof Response) return auth;

  const { data: conversation, error: conversationError } = await auth.adminClient
    .from("job_conversations")
    .select("id, job_id, application_id, client_id, professional_id, status, work_status, final_payment_made_at, completed_at, job:jobs(title)")
    .eq("id", params.conversationId)
    .single();

  if (conversationError || !conversation) return fail("Conversation not found", 404, conversationError?.message);
  if (conversation.client_id !== auth.userId) return fail("Only the client can confirm completion", 403);
  if (conversation.status !== "open") return fail("This conversation is not open", 409);
  if (!conversation.final_payment_made_at) return fail("Final payment is required before completion can be confirmed", 409);
  if (!["submitted", "revision_requested", "completed"].includes(conversation.work_status)) {
    return fail("This job is not ready for completion", 409);
  }

  if (!conversation.completed_at || conversation.work_status !== "completed") {
    const { error: updateError } = await auth.adminClient
      .from("job_conversations")
      .update({
        work_status: "completed",
        completed_at: new Date().toISOString()
      })
      .eq("id", conversation.id);

    if (updateError) return fail("Could not confirm completion", 400, updateError.message);

    const job = normalizeRelation(conversation.job as ConversationJob);
    await auth.adminClient.from("notifications").insert({
      user_id: conversation.professional_id,
      type: "job_completed",
      title: "Job completed",
      body: `The client confirmed completion${job?.title ? ` for "${job.title}"` : ""}.`,
      data: {
        conversation_id: conversation.id,
        job_id: conversation.job_id,
        application_id: conversation.application_id
      },
      channel: "in_app"
    });
  }

  const { data: updatedConversation, error: updatedError } = await auth.adminClient
    .from("job_conversations")
    .select(conversationSelect)
    .eq("id", conversation.id)
    .single();

  if (updatedError || !updatedConversation) return fail("Completion recorded, but conversation could not be refreshed", 400, updatedError?.message);

  return ok({ conversation: updatedConversation });
}
