import {
  MAX_PROPOSAL_ATTACHMENT_BYTES,
  MAX_PROPOSAL_ATTACHMENT_TOTAL_BYTES,
  MAX_PROPOSAL_ATTACHMENTS,
  proposalAttachmentExtensions,
  safeFileName,
  type ProposalAttachment
} from "@/lib/proposal-attachments";

export const JOB_DELIVERABLE_BUCKET = "job-deliverables";
export const MAX_DELIVERABLE_BYTES = MAX_PROPOSAL_ATTACHMENT_BYTES;
export const MAX_DELIVERABLE_TOTAL_BYTES = MAX_PROPOSAL_ATTACHMENT_TOTAL_BYTES;
export const MAX_DELIVERABLES = MAX_PROPOSAL_ATTACHMENTS;

export type DeliverableAttachment = ProposalAttachment;

export const deliverableExtensions = proposalAttachmentExtensions;

export function parseDeliverables(value: unknown): DeliverableAttachment[] {
  if (!Array.isArray(value)) return [];

  return value.filter((item): item is DeliverableAttachment => {
    if (!item || typeof item !== "object") return false;
    const candidate = item as Record<string, unknown>;
    return (
      typeof candidate.id === "string" &&
      typeof candidate.name === "string" &&
      typeof candidate.type === "string" &&
      typeof candidate.size === "number" &&
      typeof candidate.path === "string" &&
      typeof candidate.bucket === "string" &&
      typeof candidate.created_at === "string"
    );
  });
}

export function safeDeliverableFileName(value: string) {
  return safeFileName(value) || "job-deliverable";
}
