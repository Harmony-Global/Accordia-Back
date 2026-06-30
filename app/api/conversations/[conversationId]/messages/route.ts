import { created, fail, ok } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { conversationMessageSchema } from "@/lib/validators";

type Params = { params: { conversationId: string } };
type ConversationJob = { title?: string | null } | { title?: string | null }[] | null;

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
    .select("id, job_id, application_id, client_id, professional_id, status, job:jobs(id, title)")
    .eq("id", params.conversationId)
    .single();

  if (conversationError || !conversation) return fail("Conversation not found", 404, conversationError?.message);
  if (!canUseConversation(conversation, auth)) return fail("Forbidden for this conversation", 403);
  if (conversation.status !== "open") return fail("This conversation is not open", 409);

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

  const conversationJob = conversation.job as ConversationJob;
  const jobTitle = Array.isArray(conversationJob) ? conversationJob[0]?.title : conversationJob?.title;
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
