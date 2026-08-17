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
    .select("id, job_id, application_id, client_id, professional_id, status, work_status, upfront_payment_made_at, final_payment_made_at, job:jobs(title)")
    .eq("id", params.conversationId)
    .single();

  if (conversationError || !conversation) return fail("Conversation not found", 404, conversationError?.message);
  if (conversation.client_id !== auth.userId) return fail("Only the client can make the final payment", 403);
  if (conversation.status !== "open") return fail("This conversation is not open", 409);
  if (!conversation.upfront_payment_made_at) return fail("Upfront payment must be made first", 409);
  if (conversation.work_status !== "submitted" && conversation.work_status !== "revision_requested") {
    return fail("Final payment is available after the professional submits deliverables", 409);
  }

  const wasAlreadyPaid = Boolean(conversation.final_payment_made_at);

  if (!wasAlreadyPaid) {
    const { error: paymentError } = await auth.adminClient
      .from("job_conversations")
      .update({
        final_payment_made_at: new Date().toISOString(),
        final_payment_made_by: auth.userId
      })
      .eq("id", conversation.id);

    if (paymentError) return fail("Could not record final payment", 400, paymentError.message);

    const job = normalizeRelation(conversation.job as ConversationJob);
    await auth.adminClient.from("notifications").insert({
      user_id: conversation.professional_id,
      type: "final_payment_made",
      title: "Final payment made",
      body: `The client made the final payment${job?.title ? ` for "${job.title}"` : ""}.`,
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

  if (updatedError || !updatedConversation) return fail("Payment recorded, but conversation could not be refreshed", 400, updatedError?.message);

  return ok({ conversation: updatedConversation });
}
