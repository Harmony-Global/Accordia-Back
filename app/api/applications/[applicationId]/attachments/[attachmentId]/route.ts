import { fail, ok } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import {
  PROPOSAL_ATTACHMENT_BUCKET,
  parseProposalAttachments
} from "@/lib/proposal-attachments";

type Params = { params: { applicationId: string; attachmentId: string } };

type ApplicationPayload = {
  id: string;
  professional_id: string;
  status: string;
  proposal_attachments: unknown;
  job: { client_id: string } | null;
};

function canReadApplicationAttachment(auth: { userId: string; role: string }, application: ApplicationPayload) {
  return auth.role === "admin" || application.professional_id === auth.userId || application.job?.client_id === auth.userId;
}

function canDeleteApplicationAttachment(auth: { userId: string; role: string }, application: ApplicationPayload) {
  return application.professional_id === auth.userId && ["pending", "reviewed", "shortlisted"].includes(application.status);
}

async function loadApplication(auth: Awaited<ReturnType<typeof requireUser>>, applicationId: string) {
  if (auth instanceof Response) return { auth, application: null, error: null };

  const { data, error } = await auth.adminClient
    .from("applications")
    .select("id, professional_id, status, proposal_attachments, job:jobs(client_id)")
    .eq("id", applicationId)
    .single<ApplicationPayload>();

  return { auth, application: data, error };
}

export async function GET(request: Request, { params }: Params) {
  const authContext = await requireUser(request);
  const { auth, application, error } = await loadApplication(authContext, params.applicationId);
  if (auth instanceof Response) return auth;
  if (error || !application) return fail("Application not found", 404, error?.message);
  if (!canReadApplicationAttachment(auth, application)) return fail("Forbidden for this attachment", 403);

  const attachment = parseProposalAttachments(application.proposal_attachments).find((item) => item.id === params.attachmentId);
  if (!attachment) return fail("Attachment not found", 404);

  const { data, error: signedUrlError } = await auth.adminClient.storage
    .from(PROPOSAL_ATTACHMENT_BUCKET)
    .createSignedUrl(attachment.path, 300);

  if (signedUrlError) return fail("Could not prepare attachment access", 400, signedUrlError.message);
  return ok({ attachment, signed_url: data.signedUrl, expires_in: 300 });
}

export async function DELETE(request: Request, { params }: Params) {
  const authContext = await requireUser(request);
  const { auth, application, error } = await loadApplication(authContext, params.applicationId);
  if (auth instanceof Response) return auth;
  if (error || !application) return fail("Application not found", 404, error?.message);
  if (!canDeleteApplicationAttachment(auth, application)) return fail("Proposal attachments can no longer be changed", 403);

  const attachments = parseProposalAttachments(application.proposal_attachments);
  const attachment = attachments.find((item) => item.id === params.attachmentId);
  if (!attachment) return fail("Attachment not found", 404);

  const nextAttachments = attachments.filter((item) => item.id !== params.attachmentId);
  const { error: updateError } = await auth.adminClient
    .from("applications")
    .update({ proposal_attachments: nextAttachments })
    .eq("id", application.id)
    .eq("professional_id", auth.userId);

  if (updateError) return fail("Could not remove proposal attachment", 400, updateError.message);

  await auth.adminClient.storage.from(PROPOSAL_ATTACHMENT_BUCKET).remove([attachment.path]).catch(() => undefined);
  return ok({ attachment_id: attachment.id, attachments: nextAttachments });
}
