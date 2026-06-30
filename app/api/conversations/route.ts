import { fail, ok, parseSearchParams } from "@/lib/api";
import { requireUser } from "@/lib/auth";

export async function GET(request: Request) {
  const auth = await requireUser(request);
  if (auth instanceof Response) return auth;

  const params = parseSearchParams(request);
  const jobId = params.get("job_id");

  let query = auth.adminClient
    .from("job_conversations")
    .select("*, job:jobs(id, title, status, category:categories(*)), application:applications(id, status, pitch, reference_image_urls), client:profiles!job_conversations_client_id_fkey(id, first_name, last_name, avatar_url, phone_verified), professional:profiles!job_conversations_professional_id_fkey(id, first_name, last_name, avatar_url, phone_verified, professional_profiles(*, professional_categories(category:categories(*)), professional_services(*, category:categories(*))))")
    .order("created_at", { ascending: false });

  if (auth.role !== "admin") {
    query = query.or(`client_id.eq.${auth.userId},professional_id.eq.${auth.userId}`);
  }

  if (jobId) query = query.eq("job_id", jobId);

  const { data, error } = await query;
  if (error) return fail("Could not load conversations", 400, error.message);

  return ok({ conversations: data });
}
