import { created, fail } from "@/lib/api";
import { conversationSelect, normalizeRelation } from "@/lib/conversations";
import { requireUser } from "@/lib/auth";
import { conversationScheduleSchema } from "@/lib/validators";

type Params = { params: { conversationId: string } };
type ConversationJob = { title?: string | null; status?: string | null } | { title?: string | null; status?: string | null }[] | null;

export async function POST(request: Request, { params }: Params) {
  const auth = await requireUser(request);
  if (auth instanceof Response) return auth;

  const body = conversationScheduleSchema.safeParse(await request.json());
  if (!body.success) return fail("Invalid schedule payload", 422, body.error.flatten());

  const startsAt = new Date(body.data.starts_at);
  const endsAt = new Date(body.data.ends_at);
  if (startsAt <= new Date()) return fail("Schedule start time must be in the future", 422);
  if (endsAt <= startsAt) return fail("Schedule end time must be after the start time", 422);

  const { data: conversation, error: conversationError } = await auth.adminClient
    .from("job_conversations")
    .select("*, job:jobs(id, title, status)")
    .eq("id", params.conversationId)
    .single();

  if (conversationError || !conversation) return fail("Conversation not found", 404, conversationError?.message);
  const isClient = conversation.client_id === auth.userId;
  const isProfessional = conversation.professional_id === auth.userId;
  if (!isClient && !isProfessional) return fail("Forbidden for this conversation", 403);
  if (conversation.status !== "open") return fail("This conversation is not open", 409);
  const job = normalizeRelation(conversation.job as ConversationJob);
  if (job?.status === "closed" || job?.status === "cancelled") return fail("This job request is closed", 409);

  const { data: updatedConversation, error: updateError } = await auth.adminClient
    .from("job_conversations")
    .update({
      work_starts_at: startsAt.toISOString(),
      work_ends_at: endsAt.toISOString()
    })
    .eq("id", conversation.id)
    .select(conversationSelect)
    .single();

  if (updateError || !updatedConversation) return fail("Could not save work schedule", 400, updateError?.message);

  const messageBody = `Work schedule set: ${startsAt.toLocaleString()} - ${endsAt.toLocaleString()}.`;
  const receiverId = isClient ? conversation.professional_id : conversation.client_id;
  const { data: message, error: messageError } = await auth.adminClient
    .from("messages")
    .insert({
      conversation_id: conversation.id,
      sender_id: auth.userId,
      receiver_id: receiverId,
      job_id: conversation.job_id,
      application_id: conversation.application_id,
      body: messageBody
    })
    .select("*, sender:profiles!messages_sender_id_fkey(id, first_name, last_name, avatar_url), receiver:profiles!messages_receiver_id_fkey(id, first_name, last_name, avatar_url)")
    .single();

  if (messageError) return fail("Schedule saved, but chat notice could not be sent", 400, messageError.message);

  await auth.adminClient.from("notifications").insert({
    user_id: receiverId,
    type: "job_schedule_set",
    title: "Work schedule set",
    body: `${isClient ? "The client" : "The professional"} set a work schedule${job?.title ? ` for "${job.title}"` : ""}.`,
    data: {
      conversation_id: conversation.id,
      job_id: conversation.job_id,
      application_id: conversation.application_id
    },
    channel: "in_app"
  });

  return created({ conversation: updatedConversation, message });
}
