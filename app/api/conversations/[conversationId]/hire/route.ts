import { fail, ok } from "@/lib/api";
import { requireUser } from "@/lib/auth";

type Params = { params: { conversationId: string } };
type ConversationJob = { id: string; title?: string | null; is_remote?: boolean | null } | { id: string; title?: string | null; is_remote?: boolean | null }[] | null;

function normalizeJob(job: ConversationJob) {
  return Array.isArray(job) ? job[0] : job;
}

export async function POST(request: Request, { params }: Params) {
  const auth = await requireUser(request);
  if (auth instanceof Response) return auth;

  const { data: conversation, error: conversationError } = await auth.adminClient
    .from("job_conversations")
    .select("*, job:jobs(id, title, is_remote), application:applications(*)")
    .eq("id", params.conversationId)
    .single();

  if (conversationError || !conversation) return fail("Conversation not found", 404, conversationError?.message);
  if (conversation.client_id !== auth.userId) return fail("Only the client can hire this professional", 403);
  if (conversation.status !== "open") return fail("This conversation is not open", 409);

  const wasAlreadyPaid = Boolean(conversation.upfront_payment_made_at);

  if (!wasAlreadyPaid) {
    const { error: paymentError } = await auth.adminClient
      .from("job_conversations")
      .update({
        upfront_payment_made_at: new Date().toISOString(),
        upfront_payment_made_by: auth.userId
      })
      .eq("id", conversation.id);

    if (paymentError) return fail("Could not record upfront payment", 400, paymentError.message);
  }

  const { data: application, error: applicationError } = await auth.adminClient
    .from("applications")
    .update({ status: "selected" })
    .eq("id", conversation.application_id)
    .select("*, professional:profiles!applications_professional_id_fkey(id, first_name, last_name, phone_verified, avatar_url)")
    .single();

  if (applicationError || !application) return fail("Could not hire professional", 400, applicationError?.message);

  if (!wasAlreadyPaid) {
    const job = normalizeJob(conversation.job as ConversationJob);
    await auth.adminClient.from("notifications").insert({
      user_id: conversation.professional_id,
      type: "professional_hired",
      title: "You have been hired",
      body: `The client made an upfront payment and hired you${job?.title ? ` for "${job.title}"` : ""}.`,
      data: {
        job_id: conversation.job_id,
        application_id: conversation.application_id,
        conversation_id: conversation.id
      },
      channel: "in_app"
    });
  }

  const { data: updatedConversation, error: updatedError } = await auth.adminClient
    .from("job_conversations")
    .select("*, job:jobs(id, title, status, is_remote, category:categories(*)), application:applications(id, status, pitch, proposed_rate, estimated_days, reference_image_urls, proposal_attachments), client:profiles!job_conversations_client_id_fkey(id, first_name, last_name, avatar_url, phone_verified), professional:profiles!job_conversations_professional_id_fkey(id, first_name, last_name, avatar_url, phone_verified, professional_profiles(*, professional_categories(category:categories(*)), professional_services(*, category:categories(*))))")
    .eq("id", conversation.id)
    .single();

  if (updatedError || !updatedConversation) return fail("Professional hired, but conversation could not be refreshed", 400, updatedError?.message);

  return ok({ conversation: updatedConversation, application });
}
