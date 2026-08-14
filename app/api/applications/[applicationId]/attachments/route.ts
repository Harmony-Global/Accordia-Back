import { created, fail } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import {
  MAX_PROPOSAL_ATTACHMENT_BYTES,
  MAX_PROPOSAL_ATTACHMENT_TOTAL_BYTES,
  MAX_PROPOSAL_ATTACHMENTS,
  PROPOSAL_ATTACHMENT_BUCKET,
  parseProposalAttachments,
  proposalAttachmentExtensions,
  safeFileName,
  type ProposalAttachment
} from "@/lib/proposal-attachments";

type Params = { params: { applicationId: string } };

type ApplicationPayload = {
  id: string;
  professional_id: string;
  status: string;
  proposal_attachments: unknown;
};

export async function POST(request: Request, { params }: Params) {
  const auth = await requireRole(request, ["professional"]);
  if (auth instanceof Response) return auth;

  const formData = await request.formData();
  const file = formData.get("file");

  if (!(file instanceof File)) return fail("A proposal attachment is required", 422);
  if (!proposalAttachmentExtensions[file.type]) return fail("Unsupported proposal attachment type", 422);
  if (file.size === 0 || file.size > MAX_PROPOSAL_ATTACHMENT_BYTES) return fail("Attachment must be between 1 byte and 10 MB", 422);

  const { data: application, error: applicationError } = await auth.adminClient
    .from("applications")
    .select("id, professional_id, status, proposal_attachments")
    .eq("id", params.applicationId)
    .single<ApplicationPayload>();

  if (applicationError || !application) return fail("Application not found", 404, applicationError?.message);
  if (application.professional_id !== auth.userId) return fail("Forbidden for this application", 403);
  if (!["pending", "reviewed", "shortlisted"].includes(application.status)) return fail("Proposal attachments can no longer be changed", 400);

  const attachments = parseProposalAttachments(application.proposal_attachments);
  if (attachments.length >= MAX_PROPOSAL_ATTACHMENTS) return fail("Maximum proposal attachments reached", 422);

  const totalSize = attachments.reduce((sum, attachment) => sum + attachment.size, 0) + file.size;
  if (totalSize > MAX_PROPOSAL_ATTACHMENT_TOTAL_BYTES) return fail("Proposal attachments cannot exceed 25 MB total", 422);

  const attachmentId = crypto.randomUUID();
  const extension = proposalAttachmentExtensions[file.type];
  const objectPath = `${auth.userId}/${application.id}/${attachmentId}.${extension}`;

  const { error: uploadError } = await auth.adminClient.storage
    .from(PROPOSAL_ATTACHMENT_BUCKET)
    .upload(objectPath, await file.arrayBuffer(), {
      contentType: file.type,
      upsert: false
    });

  if (uploadError) return fail("Could not upload proposal attachment", 400, uploadError.message);

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

  const { error: updateError } = await auth.adminClient
    .from("applications")
    .update({ proposal_attachments: nextAttachments })
    .eq("id", application.id)
    .eq("professional_id", auth.userId);

  if (updateError) {
    await auth.adminClient.storage.from(PROPOSAL_ATTACHMENT_BUCKET).remove([objectPath]).catch(() => undefined);
    return fail("Attachment uploaded, but proposal could not be updated", 400, updateError.message);
  }

  return created({ attachment, attachments: nextAttachments });
}
