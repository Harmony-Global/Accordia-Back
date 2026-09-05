import { fail, ok, parseSearchParams } from "@/lib/api";
import { requireRole } from "@/lib/auth";

export async function GET(request: Request) {
  const auth = await requireRole(request, ["professional"]);
  if (auth instanceof Response) return auth;

  const params = parseSearchParams(request);
  const state = params.get("state");

  const { data: professionalProfile, error: profileError } = await auth.adminClient
    .from("professional_profiles")
    .select("id, is_available, professional_categories(category_id)")
    .eq("user_id", auth.userId)
    .single();

  if (profileError) return fail("Professional profile not found", 404, profileError.message);
  if (!professionalProfile.is_available) return ok({ jobs: [] });

  const categoryIds = (professionalProfile.professional_categories ?? []).map(
    (row: { category_id: string }) => row.category_id
  );

  if (categoryIds.length === 0) return ok({ jobs: [] });

  let query = auth.adminClient
    .from("jobs")
    .select("*, categories(*), client:profiles!jobs_client_id_fkey(id, first_name, last_name, phone_verified)")
    .in("category_id", categoryIds)
    .in("status", ["open", "in_discussion", "awarded", "in_progress", "in_review", "delivered", "completed", "closed"])
    .order("created_at", { ascending: false })
    .limit(50);

  if (state) query = query.eq("state", state);

  const { data, error } = await query;
  if (error) return fail("Could not load job feed", 400, error.message);

  const jobIds = (data ?? []).map((job) => job.id);
  if (jobIds.length === 0) return ok({ jobs: [] });

  const { data: existingApplications, error: applicationsError } = await auth.adminClient
    .from("applications")
    .select("job_id")
    .eq("professional_id", auth.userId)
    .in("job_id", jobIds);

  if (applicationsError) return fail("Could not filter matched jobs", 400, applicationsError.message);

  const appliedJobIds = new Set((existingApplications ?? []).map((application) => application.job_id));
  return ok({ jobs: (data ?? []).filter((job) => !appliedJobIds.has(job.id)) });
}
