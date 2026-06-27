import { fail, ok } from "@/lib/api";
import { requireRole } from "@/lib/auth";

type Params = { params: { jobId: string } };

export async function POST(request: Request, { params }: Params) {
  const auth = await requireRole(request, ["client"]);
  if (auth instanceof Response) return auth;

  const { data, error } = await auth.userClient.rpc("seal_job_awards", {
    p_job_id: params.jobId
  });

  if (error) return fail("Could not seal awards", 400, error.message);
  return ok(data);
}
