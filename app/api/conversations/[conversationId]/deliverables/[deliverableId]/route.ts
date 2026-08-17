import { fail, ok } from "@/lib/api";
import { canUseConversation } from "@/lib/conversations";
import { requireUser } from "@/lib/auth";
import { JOB_DELIVERABLE_BUCKET, parseDeliverables } from "@/lib/job-deliverables";

type Params = { params: { conversationId: string; deliverableId: string } };

type ConversationPayload = {
  id: string;
  client_id: string;
  professional_id: string;
  status: string;
  final_payment_made_at: string | null;
  deliverables: unknown;
};

export async function GET(request: Request, { params }: Params) {
  const auth = await requireUser(request);
  if (auth instanceof Response) return auth;

  const { data: conversation, error } = await auth.adminClient
    .from("job_conversations")
    .select("id, client_id, professional_id, status, final_payment_made_at, deliverables")
    .eq("id", params.conversationId)
    .single<ConversationPayload>();

  if (error || !conversation) return fail("Conversation not found", 404, error?.message);
  if (!canUseConversation(conversation, auth)) return fail("Forbidden for this conversation", 403);
  if (conversation.client_id === auth.userId && !conversation.final_payment_made_at) {
    return fail("Final payment is required before deliverables can be viewed", 403);
  }

  const deliverable = parseDeliverables(conversation.deliverables).find((item) => item.id === params.deliverableId);
  if (!deliverable) return fail("Deliverable not found", 404);

  const { data, error: signedUrlError } = await auth.adminClient.storage
    .from(JOB_DELIVERABLE_BUCKET)
    .createSignedUrl(deliverable.path, 300);

  if (signedUrlError) return fail("Could not prepare deliverable access", 400, signedUrlError.message);
  return ok({ deliverable, signed_url: data.signedUrl, expires_in: 300 });
}
