import { created, fail, ok } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { conversationMessageSchema } from "@/lib/validators";

type Params = { params: { conversationId: string } };
type ConversationJob = { title?: string | null; is_remote?: boolean | null } | { title?: string | null; is_remote?: boolean | null }[] | null;
const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const PHONE_PATTERN = /\+?\d[\d\s().-]{7,}\d/g;
const URL_PATTERN = /\b(?:https?:\/\/|www\.)\S+/i;

function containsContactInfo(value: string) {
  if (EMAIL_PATTERN.test(value) || URL_PATTERN.test(value)) return true;
  const candidates = value.match(PHONE_PATTERN) ?? [];
  return candidates.some((candidate) => candidate.replace(/\D/g, "").length >= 9);
}

function normalizeJob(job: ConversationJob) {
  return Array.isArray(job) ? job[0] : job;
}

function canUseConversation(
  conversation: { client_id: string; professional_id: string; status: string },
  auth: { role: string; userId: string }
) {
  return auth.role === "admin"
    || conversation.client_id === auth.userId
    || conversation.professional_id === auth.userId;
}

export async function GET(request: Request, { params }: Params) {
  const auth = await requireUser(request);
  if (auth instanceof Response) return auth;

  const { data: conversation, error: conversationError } = await auth.adminClient
    .from("job_conversations")
    .select("id, client_id, professional_id, status")
    .eq("id", params.conversationId)
    .single();

  if (conversationError || !conversation) return fail("Conversation not found", 404, conversationError?.message);
  if (!canUseConversation(conversation, auth)) return fail("Forbidden for this conversation", 403);

  const { data, error } = await auth.adminClient
    .from("messages")
    .select("*, sender:profiles!messages_sender_id_fkey(id, first_name, last_name, avatar_url), receiver:profiles!messages_receiver_id_fkey(id, first_name, last_name, avatar_url)")
    .eq("conversation_id", params.conversationId)
    .order("created_at", { ascending: true })
    .limit(200);

  if (error) return fail("Could not load conversation messages", 400, error.message);
  return ok({ messages: data });
}

export async function POST(request: Request, { params }: Params) {
  const auth = await requireUser(request);
  if (auth instanceof Response) return auth;

  const body = conversationMessageSchema.safeParse(await request.json());
  if (!body.success) return fail("Invalid message payload", 422, body.error.flatten());

  const { data: conversation, error: conversationError } = await auth.adminClient
    .from("job_conversations")
    .select("id, job_id, application_id, client_id, professional_id, status, upfront_payment_made_at, job:jobs(id, title, is_remote)")
    .eq("id", params.conversationId)
    .single();

  if (conversationError || !conversation) return fail("Conversation not found", 404, conversationError?.message);
  if (!canUseConversation(conversation, auth)) return fail("Forbidden for this conversation", 403);
  if (conversation.status !== "open") return fail("This conversation is not open", 409);

  const conversationJob = normalizeJob(conversation.job as ConversationJob);
  const contactInfoAllowed = Boolean(conversation.upfront_payment_made_at && conversationJob?.is_remote === false);
  if (containsContactInfo(body.data.body) && !contactInfoAllowed) {
    return fail("This message was blocked for sharing contact details before contact exchange is available.", 422);
  }

  const receiverId = conversation.client_id === auth.userId
    ? conversation.professional_id
    : conversation.client_id;

  const { data, error } = await auth.adminClient
    .from("messages")
    .insert({
      conversation_id: conversation.id,
      sender_id: auth.userId,
      receiver_id: receiverId,
      job_id: conversation.job_id,
      application_id: conversation.application_id,
      body: body.data.body
    })
    .select("*, sender:profiles!messages_sender_id_fkey(id, first_name, last_name, avatar_url), receiver:profiles!messages_receiver_id_fkey(id, first_name, last_name, avatar_url)")
    .single();

  if (error) return fail("Could not send message", 400, error.message);

  const jobTitle = conversationJob?.title;
  await auth.adminClient.from("notifications").insert({
    user_id: receiverId,
    type: "conversation_message",
    title: "New chat message",
    body: `You have a new message${jobTitle ? ` about "${jobTitle}"` : ""}.`,
    data: {
      conversation_id: conversation.id,
      job_id: conversation.job_id,
      application_id: conversation.application_id
    },
    channel: "in_app"
  });

  return created({ message: data });
}
