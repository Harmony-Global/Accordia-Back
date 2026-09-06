import { fail, ok } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import {
  PROPOSAL_ATTACHMENT_BUCKET,
  parseProposalAttachments
} from "@/lib/proposal-attachments";

type Params = { params: { conversationId: string; quoteId: string; attachmentId: string } };

type QuotePayload = {
  id: string;
  conversation_id: string;
  client_id: string;
  professional_id: string;
  attachments: unknown;
};

function canReadQuoteAttachment(auth: { userId: string; role: string }, quote: QuotePayload) {
  return auth.role === "admin" || quote.client_id === auth.userId || quote.professional_id === auth.userId;
}

export async function GET(request: Request, { params }: Params) {
  const auth = await requireUser(request);
  if (auth instanceof Response) return auth;

  const { data: quote, error } = await auth.adminClient
    .from("job_quotes")
    .select("id, conversation_id, client_id, professional_id, attachments")
    .eq("id", params.quoteId)
    .eq("conversation_id", params.conversationId)
    .single<QuotePayload>();

  if (error || !quote) return fail("Quote not found", 404, error?.message);
  if (!canReadQuoteAttachment(auth, quote)) return fail("Forbidden for this attachment", 403);

  const attachment = parseProposalAttachments(quote.attachments).find((item) => item.id === params.attachmentId);
  if (!attachment) return fail("Attachment not found", 404);

  const { data, error: signedUrlError } = await auth.adminClient.storage
    .from(PROPOSAL_ATTACHMENT_BUCKET)
    .createSignedUrl(attachment.path, 300);

  if (signedUrlError) return fail("Could not prepare attachment access", 400, signedUrlError.message);
  return ok({ attachment, signed_url: data.signedUrl, expires_in: 300 });
}
