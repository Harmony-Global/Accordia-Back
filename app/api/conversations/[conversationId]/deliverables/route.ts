import { created, fail } from "@/lib/api";
import { conversationSelect, normalizeRelation } from "@/lib/conversations";
import { requireRole } from "@/lib/auth";
import {
  JOB_DELIVERABLE_BUCKET,
  MAX_DELIVERABLE_BYTES,
  MAX_DELIVERABLE_TOTAL_BYTES,
  MAX_DELIVERABLES,
  deliverableExtensions,
  parseDeliverables,
  safeDeliverableFileName,
  type DeliverableAttachment
} from "@/lib/job-deliverables";

type Params = { params: { conversationId: string } };

type ConversationPayload = {
  id: string;
  job_id: string;
  application_id: string;
  client_id: string;
  professional_id: string;
  status: string;
  work_status: string;
  upfront_payment_made_at: string | null;
  deliverables: unknown;
  job?: { title?: string | null } | { title?: string | null }[] | null;
};

export async function POST(request: Request, { params }: Params) {
  const auth = await requireRole(request, ["professional"]);
  if (auth instanceof Response) return auth;

  const formData = await request.formData();
  const file = formData.get("file");

  if (!(file instanceof File)) return fail("A deliverable file is required", 422);
  if (!deliverableExtensions[file.type]) return fail("Unsupported deliverable file type", 422);
  if (file.size === 0 || file.size > MAX_DELIVERABLE_BYTES) return fail("Deliverable must be between 1 byte and 10 MB", 422);

  const { data: conversation, error: conversationError } = await auth.adminClient
    .from("job_conversations")
    .select("id, job_id, application_id, client_id, professional_id, status, work_status, upfront_payment_made_at, deliverables, job:jobs(title)")
    .eq("id", params.conversationId)
    .single<ConversationPayload>();

  if (conversationError || !conversation) return fail("Conversation not found", 404, conversationError?.message);
  if (conversation.professional_id !== auth.userId) return fail("Forbidden for this conversation", 403);
  if (conversation.status !== "open") return fail("This conversation is not open", 409);
  if (!conversation.upfront_payment_made_at) return fail("The professional must be hired before deliverables can be submitted", 409);
  if (!["in_progress", "revision_requested", "submitted"].includes(conversation.work_status)) {
    return fail("Deliverables can no longer be changed for this job", 409);
  }

  const deliverables = parseDeliverables(conversation.deliverables);
  if (deliverables.length >= MAX_DELIVERABLES) return fail("Maximum deliverables reached", 422);

  const totalSize = deliverables.reduce((sum, deliverable) => sum + deliverable.size, 0) + file.size;
  if (totalSize > MAX_DELIVERABLE_TOTAL_BYTES) return fail("Deliverables cannot exceed 25 MB total", 422);

  const deliverableId = crypto.randomUUID();
  const extension = deliverableExtensions[file.type];
  const objectPath = `${auth.userId}/${conversation.id}/${deliverableId}.${extension}`;

  const { error: uploadError } = await auth.adminClient.storage
    .from(JOB_DELIVERABLE_BUCKET)
    .upload(objectPath, await file.arrayBuffer(), {
      contentType: file.type,
      upsert: false
    });

  if (uploadError) return fail("Could not upload deliverable", 400, uploadError.message);

  const deliverable: DeliverableAttachment = {
    id: deliverableId,
    name: safeDeliverableFileName(file.name),
    type: file.type,
    size: file.size,
    path: objectPath,
    bucket: JOB_DELIVERABLE_BUCKET,
    created_at: new Date().toISOString()
  };
  const nextDeliverables = [...deliverables, deliverable];

  const { data: updatedConversation, error: updateError } = await auth.adminClient
    .from("job_conversations")
    .update({
      deliverables: nextDeliverables,
      work_status: "submitted",
      work_submitted_at: new Date().toISOString(),
      revision_note: null
    })
    .eq("id", conversation.id)
    .select(conversationSelect)
    .single();

  if (updateError || !updatedConversation) {
    await auth.adminClient.storage.from(JOB_DELIVERABLE_BUCKET).remove([objectPath]).catch(() => undefined);
    return fail("Deliverable uploaded, but conversation could not be updated", 400, updateError?.message);
  }

  const job = normalizeRelation(conversation.job);
  await auth.adminClient.from("notifications").insert({
    user_id: conversation.client_id,
    type: "work_submitted",
    title: "Work submitted",
    body: `The professional submitted deliverables${job?.title ? ` for "${job.title}"` : ""}.`,
    data: {
      conversation_id: conversation.id,
      job_id: conversation.job_id,
      application_id: conversation.application_id
    },
    channel: "in_app"
  });

  return created({ deliverable, conversation: updatedConversation });
}
