export const PROPOSAL_ATTACHMENT_BUCKET = "application-proposal-attachments";
export const MAX_PROPOSAL_ATTACHMENT_BYTES = 10 * 1024 * 1024;
export const MAX_PROPOSAL_ATTACHMENT_TOTAL_BYTES = 25 * 1024 * 1024;
export const MAX_PROPOSAL_ATTACHMENTS = 5;

export type ProposalAttachment = {
  id: string;
  name: string;
  type: string;
  size: number;
  path: string;
  bucket: string;
  created_at: string;
};

export const proposalAttachmentExtensions: Record<string, string> = {
  "application/pdf": "pdf",
  "text/csv": "csv",
  "application/csv": "csv",
  "application/vnd.ms-excel": "xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp"
};

export function parseProposalAttachments(value: unknown): ProposalAttachment[] {
  if (!Array.isArray(value)) return [];

  return value.filter((item): item is ProposalAttachment => {
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

export function safeFileName(value: string) {
  return value.replace(/[^\w.\- ]+/g, "").replace(/\s+/g, " ").trim().slice(0, 120) || "proposal-attachment";
}
