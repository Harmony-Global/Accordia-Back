import { fail, ok } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { quoteReviewSchema } from "@/lib/validators";

type Params = { params: { conversationId: string; quoteId: string } };

const quoteSelect = "*, job:jobs(id, title, price_type, price_amount, currency)";

export async function POST(request: Request, { params }: Params) {
  const auth = await requireUser(request);
  if (auth instanceof Response) return auth;

  const body = quoteReviewSchema.safeParse(await request.json());
  if (!body.success) return fail("Invalid quote review payload", 422, body.error.flatten());

  const { data: quote, error: quoteError } = await auth.adminClient
    .from("job_quotes")
    .select(quoteSelect)
    .eq("id", params.quoteId)
    .eq("conversation_id", params.conversationId)
    .single();

  if (quoteError || !quote) return fail("Quote not found", 404, quoteError?.message);
  if (quote.client_id !== auth.userId && auth.role !== "admin") return fail("Only the client can request a quote review", 403);
  if (quote.status === "accepted") return fail("Accepted quotes cannot be sent back for review", 409);
  if (quote.status === "superseded") return fail("This quote has already been revised", 409);

  const { data: reviewedQuote, error: updateError } = await auth.adminClient
    .from("job_quotes")
    .update({
      status: "review_requested",
      review_note: body.data.note,
      review_requested_by: auth.userId,
      review_requested_at: new Date().toISOString()
    })
    .eq("id", params.quoteId)
    .select(quoteSelect)
    .single();

  if (updateError || !reviewedQuote) return fail("Could not request quote review", 400, updateError?.message);

  const { data: message, error: messageError } = await auth.adminClient
    .from("messages")
    .insert({
      conversation_id: reviewedQuote.conversation_id,
      sender_id: auth.userId,
      receiver_id: reviewedQuote.professional_id,
      job_id: reviewedQuote.job_id,
      application_id: reviewedQuote.application_id,
      body: `Quote review requested: ${body.data.note}`
    })
    .select("*, sender:profiles!messages_sender_id_fkey(id, first_name, last_name, avatar_url), receiver:profiles!messages_receiver_id_fkey(id, first_name, last_name, avatar_url)")
    .single();
  if (messageError) return fail("Quote review requested, but chat notice could not be sent", 400, messageError.message);

  await auth.adminClient.from("notifications").insert({
    user_id: reviewedQuote.professional_id,
    type: "job_quote_review_requested",
    title: "Quote review requested",
    body: "The client requested changes to your quote.",
    data: {
      conversation_id: reviewedQuote.conversation_id,
      job_id: reviewedQuote.job_id,
      application_id: reviewedQuote.application_id,
      quote_id: reviewedQuote.id
    },
    channel: "in_app"
  });

  return ok({ quote: reviewedQuote, message });
}
