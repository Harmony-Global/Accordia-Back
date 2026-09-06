import { created, fail } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import {
  MAX_PROPOSAL_ATTACHMENT_TOTAL_BYTES,
  MAX_PROPOSAL_ATTACHMENTS,
  PROPOSAL_ATTACHMENT_BUCKET,
  parseProposalAttachments,
  proposalAttachmentExtensions,
  safeFileName,
  type ProposalAttachment
} from "@/lib/proposal-attachments";

type Params = { params: { conversationId: string; quoteId: string } };
const MAX_QUOTE_ATTACHMENT_BYTES = 5 * 1024 * 1024;

type QuotePayload = {
  id: string;
  conversation_id: string;
  professional_id: string;
  status: string;
  attachments: unknown;
};

const quoteSelect = "*, job:jobs(id, title, price_type, price_amount, currency)";

export async function POST(request: Request, { params }: Params) {
  const auth = await requireUser(request);
  if (auth instanceof Response) return auth;

  const formData = await request.formData();
  const file = formData.get("file");

  if (!(file instanceof File)) return fail("A quote attachment is required", 422);
  if (!proposalAttachmentExtensions[file.type]) return fail("Unsupported quote attachment type", 422);
  if (file.size === 0 || file.size > MAX_QUOTE_ATTACHMENT_BYTES) return fail("Attachment must be between 1 byte and 5 MB", 422);

  const { data: quote, error: quoteError } = await auth.adminClient
    .from("job_quotes")
    .select("id, conversation_id, professional_id, status, attachments")
    .eq("id", params.quoteId)
    .eq("conversation_id", params.conversationId)
    .single<QuotePayload>();

  if (quoteError || !quote) return fail("Quote not found", 404, quoteError?.message);
  if (quote.professional_id !== auth.userId && auth.role !== "admin") return fail("Only the professional can upload quote attachments", 403);
  if (!["sent", "review_requested"].includes(quote.status)) return fail("Quote attachments can no longer be changed", 409);

  const attachments = parseProposalAttachments(quote.attachments);
  if (attachments.length >= MAX_PROPOSAL_ATTACHMENTS) return fail("Maximum quote attachments reached", 422);

  const totalSize = attachments.reduce((sum, attachment) => sum + attachment.size, 0) + file.size;
  if (totalSize > MAX_PROPOSAL_ATTACHMENT_TOTAL_BYTES) return fail("Quote attachments cannot exceed 25 MB total", 422);

  const attachmentId = crypto.randomUUID();
  const extension = proposalAttachmentExtensions[file.type];
  const objectPath = `${auth.userId}/quotes/${quote.id}/${attachmentId}.${extension}`;

  const { error: uploadError } = await auth.adminClient.storage
    .from(PROPOSAL_ATTACHMENT_BUCKET)
    .upload(objectPath, await file.arrayBuffer(), {
      contentType: file.type,
      upsert: false
    });

  if (uploadError) return fail("Could not upload quote attachment", 400, uploadError.message);

  const attachment: ProposalAttachment = {
    id: attachmentId,
    name: safeFileName(file.name),
    type: file.type,
    size: file.size,
    path: objectPath,
    bucket: PROPOSAL_ATTACHMENT_BUCKET,
    created_at: new Date().toISOString()
  };
  const nextAttachments = [...attachments, attachment];

  const { data: updatedQuote, error: updateError } = await auth.adminClient
    .from("job_quotes")
    .update({ attachments: nextAttachments })
    .eq("id", quote.id)
    .select(quoteSelect)
    .single();

  if (updateError || !updatedQuote) {
    await auth.adminClient.storage.from(PROPOSAL_ATTACHMENT_BUCKET).remove([objectPath]).catch(() => undefined);
    return fail("Attachment uploaded, but quote could not be updated", 400, updateError?.message);
  }

  return created({ attachment, quote: updatedQuote });
}
