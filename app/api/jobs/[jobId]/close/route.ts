import { fail, ok } from "@/lib/api";
import { requireRole } from "@/lib/auth";

type Params = { params: { jobId: string } };

function closeErrorStatus(message?: string) {
  if (!message) return 400;
  if (message.includes("not found")) return 404;
  if (message.includes("Only the client") || message.includes("Forbidden")) return 403;
  if (message.includes("already closed") || message.includes("Only open job requests")) return 409;
  return 400;
}

export async function POST(request: Request, { params }: Params) {
  const auth = await requireRole(request, ["client", "admin"]);
  if (auth instanceof Response) return auth;

  const { data, error } = await auth.userClient.rpc("close_job_request", {
    p_job_id: params.jobId
  });

  if (error) return fail("Could not close job request", closeErrorStatus(error.message), error.message);
  return ok({ job: data });
}
