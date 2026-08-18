import { fail, ok } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { conversationSelect } from "@/lib/conversations";
import { conversationReviewSchema } from "@/lib/validators";

type Params = { params: { conversationId: string } };

export async function POST(request: Request, { params }: Params) {
  const auth = await requireRole(request, ["client"]);
  if (auth instanceof Response) return auth;

  const body = conversationReviewSchema.safeParse(await request.json());
  if (!body.success) return fail("Invalid review payload", 422, body.error.flatten());

  const { data: conversation, error: conversationError } = await auth.adminClient
    .from("job_conversations")
    .select("id, job_id, application_id, client_id, professional_id, status, work_status, completed_at")
    .eq("id", params.conversationId)
    .single();

  if (conversationError || !conversation) return fail("Conversation not found", 404, conversationError?.message);
  if (conversation.client_id !== auth.userId) return fail("Only the client can review this professional", 403);
  if (conversation.status !== "open") return fail("This conversation is not open", 409);
  if (conversation.work_status !== "completed" || !conversation.completed_at) {
    return fail("This job must be completed before it can be reviewed", 409);
  }

  const { data: existingReview, error: existingError } = await auth.adminClient
    .from("conversation_reviews")
    .select("*")
    .eq("conversation_id", conversation.id)
    .maybeSingle();

  if (existingError) return fail("Could not check review status", 400, existingError.message);

  if (!existingReview) {
    const { error: insertError } = await auth.adminClient.from("conversation_reviews").insert({
      conversation_id: conversation.id,
      job_id: conversation.job_id,
      application_id: conversation.application_id,
      client_id: conversation.client_id,
      professional_id: conversation.professional_id,
      rating: body.data.skipped ? null : body.data.rating,
      review_text: body.data.review_text?.trim() || null,
      skipped: body.data.skipped
    });

    if (insertError) return fail("Could not save review", 400, insertError.message);
  }

  const { data: updatedConversation, error: updatedError } = await auth.adminClient
    .from("job_conversations")
    .select(conversationSelect)
    .eq("id", conversation.id)
    .single();

  if (updatedError || !updatedConversation) return fail("Review saved, but conversation could not be refreshed", 400, updatedError?.message);

  return ok({ conversation: updatedConversation });
}
