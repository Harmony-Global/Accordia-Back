import { fail, ok, parseSearchParams } from "@/lib/api";
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
    .select("*, job:jobs(id, title, status, category:categories(*)), application:applications(id, status, pitch, proposed_rate, estimated_days, reference_image_urls, proposal_attachments), client:profiles!job_conversations_client_id_fkey(id, first_name, last_name, avatar_url, phone_verified), professional:profiles!job_conversations_professional_id_fkey(id, first_name, last_name, avatar_url, phone_verified, professional_profiles(*, professional_categories(category:categories(*)), professional_services(*, category:categories(*))))")
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
