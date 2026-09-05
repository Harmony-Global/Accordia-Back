import { created, fail, ok } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { normalizeRelation } from "@/lib/conversations";
import { jobQuoteSchema } from "@/lib/validators";

type Params = { params: { conversationId: string } };
type ConversationJob = {
  id: string;
  title?: string | null;
  status?: string | null;
  price_type?: "fixed" | "negotiable" | string | null;
  price_amount?: number | string | null;
  currency?: string | null;
} | {
  id: string;
  title?: string | null;
  status?: string | null;
  price_type?: "fixed" | "negotiable" | string | null;
  price_amount?: number | string | null;
  currency?: string | null;
}[] | null;
type AuthContext = Exclude<Awaited<ReturnType<typeof requireUser>>, Response>;

const quoteSelect = "*, job:jobs(id, title, price_type, price_amount, currency)";

function quoteAmount(value: number | string | null | undefined) {
  if (value === null || value === undefined) return null;
  const amount = Number(value);
  return Number.isFinite(amount) ? amount : null;
}

async function loadConversation(auth: AuthContext, conversationId: string) {
  return auth.adminClient
    .from("job_conversations")
    .select("*, job:jobs(id, title, status, price_type, price_amount, currency)")
    .eq("id", conversationId)
    .single();
}

export async function GET(request: Request, { params }: Params) {
  const auth = await requireUser(request);
  if (auth instanceof Response) return auth;

  const { data: conversation, error: conversationError } = await loadConversation(auth, params.conversationId);
  if (conversationError || !conversation) return fail("Conversation not found", 404, conversationError?.message);
  if (conversation.client_id !== auth.userId && conversation.professional_id !== auth.userId && auth.role !== "admin") {
    return fail("Forbidden for this conversation", 403);
  }

  const { data, error } = await auth.adminClient
    .from("job_quotes")
    .select(quoteSelect)
    .eq("conversation_id", conversation.id)
    .order("created_at", { ascending: false });

  if (error) return fail("Could not load quotes", 400, error.message);
  return ok({ quotes: data ?? [] });
}

export async function POST(request: Request, { params }: Params) {
  const auth = await requireUser(request);
  if (auth instanceof Response) return auth;

  const body = jobQuoteSchema.safeParse(await request.json());
  if (!body.success) return fail("Invalid quote payload", 422, body.error.flatten());

  const { data: conversation, error: conversationError } = await loadConversation(auth, params.conversationId);
  if (conversationError || !conversation) return fail("Conversation not found", 404, conversationError?.message);
  if (conversation.professional_id !== auth.userId) return fail("Only the professional can send a quote", 403);
  if (conversation.status !== "open") return fail("This conversation is not open", 409);

  const job = normalizeRelation(conversation.job as ConversationJob);
  if (!job || ["closed", "cancelled"].includes(String(job.status ?? "").toLowerCase())) {
    return fail("This job request is closed", 409);
  }

  const fixedAmount = job.price_type === "fixed" ? quoteAmount(job.price_amount) : null;
  if (job.price_type === "fixed" && fixedAmount === null) return fail("This fixed-price request does not have a price set", 409);
  if (fixedAmount !== null && body.data.total_budget !== fixedAmount) {
    return fail("Fixed-price job quotes must use the job request price", 422);
  }

  const { count, error: countError } = await auth.adminClient
    .from("job_quotes")
    .select("id", { count: "exact", head: true })
    .eq("conversation_id", conversation.id);
  if (countError) return fail("Could not check quote history", 400, countError.message);

  const { data: acceptedQuote, error: acceptedError } = await auth.adminClient
    .from("job_quotes")
    .select("id")
    .eq("conversation_id", conversation.id)
    .eq("status", "accepted")
    .maybeSingle();
  if (acceptedError) return fail("Could not check accepted quote", 400, acceptedError.message);
  if (acceptedQuote) return fail("This conversation already has an accepted quote", 409);

  await auth.adminClient
    .from("job_quotes")
    .update({ status: "superseded" })
    .eq("conversation_id", conversation.id)
    .in("status", ["sent", "review_requested"]);

  const { data: quote, error: quoteError } = await auth.adminClient
    .from("job_quotes")
    .insert({
      conversation_id: conversation.id,
      job_id: conversation.job_id,
      application_id: conversation.application_id,
      client_id: conversation.client_id,
      professional_id: conversation.professional_id,
      version: (count ?? 0) + 1,
      project_title: body.data.project_title,
      project_description: body.data.project_description,
      total_budget: fixedAmount ?? body.data.total_budget,
      duration_days: body.data.duration_days,
      attachments: body.data.attachments,
      created_by: auth.userId
    })
    .select(quoteSelect)
    .single();

  if (quoteError || !quote) return fail("Could not save quote", 400, quoteError?.message);

  const amount = Number(quote.total_budget).toLocaleString();
  const currency = job.currency ?? "NGN";
  const messageBody = `Quote sent: ${quote.project_title} - ${currency} ${amount}.`;
  const { data: message, error: messageError } = await auth.adminClient
    .from("messages")
    .insert({
      conversation_id: conversation.id,
      sender_id: conversation.professional_id,
      receiver_id: conversation.client_id,
      job_id: conversation.job_id,
      application_id: conversation.application_id,
      body: messageBody
    })
    .select("*, sender:profiles!messages_sender_id_fkey(id, first_name, last_name, avatar_url), receiver:profiles!messages_receiver_id_fkey(id, first_name, last_name, avatar_url)")
    .single();

  if (messageError) return fail("Quote saved, but chat notice could not be sent", 400, messageError.message);

  await auth.adminClient.from("notifications").insert({
    user_id: conversation.client_id,
    type: "job_quote_sent",
    title: "Quote sent",
    body: `A quote was sent${job.title ? ` for "${job.title}"` : ""}.`,
    data: {
      conversation_id: conversation.id,
      job_id: conversation.job_id,
      application_id: conversation.application_id,
      quote_id: quote.id
    },
    channel: "in_app"
  });

  return created({ quote, message });
}
