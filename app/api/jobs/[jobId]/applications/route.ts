import { fail, ok } from "@/lib/api";
import { requireRole } from "@/lib/auth";

type Params = { params: { jobId: string } };

export async function GET(request: Request, { params }: Params) {
  const auth = await requireRole(request, ["client", "admin"]);
  if (auth instanceof Response) return auth;

  const { data, error } = await auth.userClient
    .from("applications")
    .select("*, professional:profiles!applications_professional_id_fkey(id, first_name, last_name, phone_verified, avatar_url)")
    .eq("job_id", params.jobId)
    .order("created_at", { ascending: false });

  if (error) return fail("Could not load applications", 400, error.message);
  return ok({ applications: data });
}
