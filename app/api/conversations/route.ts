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

  return ok({ conversations: (data ?? []).map((conversation) => filterInactiveOfferings(conversation as ConversationPayload)) });
}
