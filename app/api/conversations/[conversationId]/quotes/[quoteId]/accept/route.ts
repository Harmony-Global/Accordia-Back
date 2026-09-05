import { fail, ok } from "@/lib/api";
import { requireUser } from "@/lib/auth";

type Params = { params: { conversationId: string; quoteId: string } };

const quoteSelect = "*, job:jobs(id, title, price_type, price_amount, currency)";

export async function POST(request: Request, { params }: Params) {
  const auth = await requireUser(request);
  if (auth instanceof Response) return auth;

  const { data: quote, error: quoteError } = await auth.adminClient
    .from("job_quotes")
    .select(quoteSelect)
    .eq("id", params.quoteId)
    .eq("conversation_id", params.conversationId)
    .single();

  if (quoteError || !quote) return fail("Quote not found", 404, quoteError?.message);
  if (quote.client_id !== auth.userId && auth.role !== "admin") return fail("Only the client can accept this quote", 403);
  if (quote.status === "accepted") return ok({ quote });
  if (!["sent", "review_requested"].includes(quote.status)) return fail("This quote can no longer be accepted", 409);

  const { error: supersedeError } = await auth.adminClient
    .from("job_quotes")
    .update({ status: "superseded" })
    .eq("conversation_id", params.conversationId)
    .neq("id", params.quoteId)
    .in("status", ["sent", "review_requested"]);
  if (supersedeError) return fail("Could not finalize quote history", 400, supersedeError.message);

  const { data: acceptedQuote, error: updateError } = await auth.adminClient
    .from("job_quotes")
    .update({
      status: "accepted",
      accepted_by: auth.userId,
      accepted_at: new Date().toISOString()
    })
    .eq("id", params.quoteId)
    .select(quoteSelect)
    .single();

  if (updateError || !acceptedQuote) return fail("Could not accept quote", 400, updateError?.message);

  const { data: message, error: messageError } = await auth.adminClient
    .from("messages")
    .insert({
      conversation_id: acceptedQuote.conversation_id,
      sender_id: auth.userId,
      receiver_id: acceptedQuote.professional_id,
      job_id: acceptedQuote.job_id,
      application_id: acceptedQuote.application_id,
      body: `Quote accepted: ${acceptedQuote.project_title}.`
    })
    .select("*, sender:profiles!messages_sender_id_fkey(id, first_name, last_name, avatar_url), receiver:profiles!messages_receiver_id_fkey(id, first_name, last_name, avatar_url)")
    .single();
  if (messageError) return fail("Quote accepted, but chat notice could not be sent", 400, messageError.message);

  await auth.adminClient.from("notifications").insert({
    user_id: acceptedQuote.professional_id,
    type: "job_quote_accepted",
    title: "Quote accepted",
    body: `The client accepted your quote for "${acceptedQuote.project_title}".`,
    data: {
      conversation_id: acceptedQuote.conversation_id,
      job_id: acceptedQuote.job_id,
      application_id: acceptedQuote.application_id,
      quote_id: acceptedQuote.id
    },
    channel: "in_app"
  });

  return ok({ quote: acceptedQuote, message });
}
