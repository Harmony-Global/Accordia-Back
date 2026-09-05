import { fail, ok } from "@/lib/api";
import { requireRole } from "@/lib/auth";

type Params = { params: { jobId: string } };

export async function GET(request: Request, { params }: Params) {
  const auth = await requireRole(request, ["client", "admin"]);
  if (auth instanceof Response) return auth;

  const { data: job, error: jobError } = await auth.adminClient
    .from("jobs")
    .select("id, client_id")
    .eq("id", params.jobId)
    .single();

  if (jobError || !job) return fail("Job not found", 404, jobError?.message);
  if (auth.role !== "admin" && job.client_id !== auth.userId) return fail("Forbidden for this job", 403);

  const { data, error } = await auth.adminClient
    .from("applications")
    .select(`
      *,
      professional:profiles!applications_professional_id_fkey(
        id,
        first_name,
        last_name,
        phone_verified,
        avatar_url,
        professional_profiles(
          id,
          user_id,
          bio,
          years_experience,
          location,
          state,
          is_available,
          professional_categories(category:categories(id, name, slug, icon)),
          professional_services(id, professional_id, category_id, offering_type, title, description, image_url, price_min, price_max, currency, is_active, created_at, updated_at, category:categories(id, name, slug, icon))
        )
      )
    `)
    .eq("job_id", params.jobId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false });

  if (error) return fail("Could not load applications", 400, error.message);
  return ok({ applications: data });
}
