import { fail, ok, parseSearchParams } from "@/lib/api";
import { conversationSelect } from "@/lib/conversations";
import { requireUser } from "@/lib/auth";

type ProfessionalProfilePayload = {
  professional_services?: Array<{ is_active?: boolean }> | null;
};

type ConversationPayload = {
  professional?: {
    professional_profiles?: ProfessionalProfilePayload | ProfessionalProfilePayload[] | null;
  } | null;
};

function filterInactiveOfferings(conversation: ConversationPayload) {
  const profiles = conversation.professional?.professional_profiles;
  const profileList = Array.isArray(profiles) ? profiles : profiles ? [profiles] : [];

  for (const profile of profileList) {
    if (Array.isArray(profile.professional_services)) {
      profile.professional_services = profile.professional_services.filter((service) => service.is_active);
    }
  }

  return conversation;
}

function attachUnreadCounts<T extends { id?: string | null }>(conversations: T[], unreadCounts: Map<string, number>) {
  return conversations.map((conversation) => ({
    ...conversation,
    unread_message_count: conversation.id ? unreadCounts.get(conversation.id) ?? 0 : 0
  }));
}

export async function GET(request: Request) {
  const auth = await requireUser(request);
  if (auth instanceof Response) return auth;

  const params = parseSearchParams(request);
  const jobId = params.get("job_id");

  let query = auth.adminClient
    .from("job_conversations")
    .select(conversationSelect)
    .eq("status", "open")
    .order("created_at", { ascending: false });

  if (auth.role !== "admin") {
    query = query.or(`client_id.eq.${auth.userId},professional_id.eq.${auth.userId}`);
  }

  if (jobId) query = query.eq("job_id", jobId);

  const { data, error } = await query;
  if (error) return fail("Could not load conversations", 400, error.message);

  const conversations = (data ?? []).map((conversation) => filterInactiveOfferings(conversation as ConversationPayload));
  const conversationIds = conversations.map((conversation) => (conversation as { id?: string }).id).filter(Boolean) as string[];
  const unreadCounts = new Map<string, number>();

  if (conversationIds.length > 0) {
    const { data: unreadMessages, error: unreadError } = await auth.adminClient
      .from("messages")
      .select("conversation_id")
      .in("conversation_id", conversationIds)
      .eq("receiver_id", auth.userId)
      .eq("is_read", false);

    if (unreadError) return fail("Could not load conversation unread counts", 400, unreadError.message);

    for (const message of unreadMessages ?? []) {
      if (!message.conversation_id) continue;
      unreadCounts.set(message.conversation_id, (unreadCounts.get(message.conversation_id) ?? 0) + 1);
    }
  }

  return ok({ conversations: attachUnreadCounts(conversations as Array<ConversationPayload & { id?: string }>, unreadCounts) });
}
