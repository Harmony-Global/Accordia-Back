import { created, fail } from "@/lib/api";
import { conversationSelect, normalizeRelation } from "@/lib/conversations";
import { requireRole } from "@/lib/auth";
import { conversationScheduleSchema } from "@/lib/validators";

type Params = { params: { conversationId: string } };
type ConversationJob = { title?: string | null } | { title?: string | null }[] | null;

export async function POST(request: Request, { params }: Params) {
  const auth = await requireRole(request, ["professional"]);
  if (auth instanceof Response) return auth;

  const body = conversationScheduleSchema.safeParse(await request.json());
  if (!body.success) return fail("Invalid schedule payload", 422, body.error.flatten());

  const startsAt = new Date(body.data.starts_at);
  const endsAt = new Date(body.data.ends_at);
  if (startsAt <= new Date()) return fail("Schedule start time must be in the future", 422);
  if (endsAt <= startsAt) return fail("Schedule end time must be after the start time", 422);

  const { data: conversation, error: conversationError } = await auth.adminClient
    .from("job_conversations")
    .select("*, job:jobs(id, title)")
    .eq("id", params.conversationId)
    .single();

  if (conversationError || !conversation) return fail("Conversation not found", 404, conversationError?.message);
  if (conversation.professional_id !== auth.userId) return fail("Only the professional can set the work schedule", 403);
  if (conversation.status !== "open") return fail("This conversation is not open", 409);

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
  const { data: message, error: messageError } = await auth.adminClient
    .from("messages")
    .insert({
      conversation_id: conversation.id,
      sender_id: conversation.professional_id,
      receiver_id: conversation.client_id,
      job_id: conversation.job_id,
      application_id: conversation.application_id,
      body: messageBody
    })
    .select("*, sender:profiles!messages_sender_id_fkey(id, first_name, last_name, avatar_url), receiver:profiles!messages_receiver_id_fkey(id, first_name, last_name, avatar_url)")
    .single();

  if (messageError) return fail("Schedule saved, but chat notice could not be sent", 400, messageError.message);

  const job = normalizeRelation(conversation.job as ConversationJob);
  await auth.adminClient.from("notifications").insert({
    user_id: conversation.client_id,
    type: "job_schedule_set",
    title: "Work schedule set",
    body: `The professional set a work schedule${job?.title ? ` for "${job.title}"` : ""}.`,
    data: {
      conversation_id: conversation.id,
      job_id: conversation.job_id,
      application_id: conversation.application_id
    },
    channel: "in_app"
  });

  return created({ conversation: updatedConversation, message });
}
