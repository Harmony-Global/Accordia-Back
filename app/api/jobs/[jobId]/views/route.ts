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
    .from("job_views")
    .select("id, viewed_at, professional:profiles!job_views_professional_id_fkey(id, first_name, last_name, phone_verified, avatar_url)")
    .eq("job_id", params.jobId)
    .order("viewed_at", { ascending: false });

  if (error) return fail("Could not load job views", 400, error.message);
  return ok({ views: data });
}
