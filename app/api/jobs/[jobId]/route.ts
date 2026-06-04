import { fail, ok } from "@/lib/api";
import { requireRole, requireUser } from "@/lib/auth";
import { updateJobSchema } from "@/lib/validators";

type Params = { params: { jobId: string } };

export async function GET(request: Request, { params }: Params) {
  const auth = await requireUser(request);
  if (auth instanceof Response) return auth;

  if (auth.role === "professional") {
    await auth.userClient.rpc("record_job_view", { p_job_id: params.jobId });
  }

  const { data, error } = await auth.userClient
    .from("jobs")
    .select("*, categories(*), client:profiles!jobs_client_id_fkey(id, first_name, last_name, phone_verified)")
    .eq("id", params.jobId)
    .single();

  if (error) return fail("Could not load job", 404, error.message);
  return ok({ job: data });
}

export async function PATCH(request: Request, { params }: Params) {
  const auth = await requireRole(request, ["client", "admin"]);
  if (auth instanceof Response) return auth;

  const body = updateJobSchema.safeParse(await request.json());
  if (!body.success) return fail("Invalid job update payload", 422, body.error.flatten());

  const { data, error } = await auth.userClient
    .from("jobs")
    .update(body.data)
    .eq("id", params.jobId)
    .select("*")
    .single();

  if (error) return fail("Could not update job", 400, error.message);
  return ok({ job: data });
}
