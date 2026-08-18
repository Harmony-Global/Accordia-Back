import { fail, ok } from "@/lib/api";
import { conversationSelect } from "@/lib/conversations";
import { requireUser } from "@/lib/auth";

type Params = { params: { conversationId: string } };
type ConversationJob = {
  id: string;
  title?: string | null;
  is_remote?: boolean | null;
  number_of_professionals?: number | null;
} | {
  id: string;
  title?: string | null;
  is_remote?: boolean | null;
  number_of_professionals?: number | null;
}[] | null;

function normalizeJob(job: ConversationJob) {
  return Array.isArray(job) ? job[0] : job;
}

export async function POST(request: Request, { params }: Params) {
  const auth = await requireUser(request);
  if (auth instanceof Response) return auth;

  const { data: conversation, error: conversationError } = await auth.adminClient
    .from("job_conversations")
    .select("*, job:jobs(id, title, is_remote, number_of_professionals), application:applications(*)")
    .eq("id", params.conversationId)
    .single();

  if (conversationError || !conversation) return fail("Conversation not found", 404, conversationError?.message);
  if (conversation.client_id !== auth.userId) return fail("Only the client can hire this professional", 403);
  if (conversation.status !== "open") return fail("This conversation is not open", 409);

  const wasAlreadyPaid = Boolean(conversation.upfront_payment_made_at);
  const job = normalizeJob(conversation.job as ConversationJob);

  if (!wasAlreadyPaid) {
    const professionalCap = Math.max(1, Number(job?.number_of_professionals ?? 1));
    const { count, error: countError } = await auth.adminClient
      .from("job_conversations")
      .select("id", { count: "exact", head: true })
      .eq("job_id", conversation.job_id)
      .not("upfront_payment_made_at", "is", null);

    if (countError) return fail("Could not verify hiring capacity", 400, countError.message);
    if ((count ?? 0) >= professionalCap) {
      return fail(`This request already has the required ${professionalCap} hired professional${professionalCap === 1 ? "" : "s"}.`, 409);
    }
  }

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
    .select(conversationSelect)
    .eq("id", conversation.id)
    .single();

  if (updatedError || !updatedConversation) return fail("Professional hired, but conversation could not be refreshed", 400, updatedError?.message);

  return ok({ conversation: updatedConversation, application });
}
