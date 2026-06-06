import { created, fail, ok } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { progressSchema } from "@/lib/validators";

type Params = { params: { jobId: string } };

function progressErrorStatus(message?: string) {
  if (!message) return 400;
  if (message.includes("not found")) return 404;
  if (message.includes("Only")) return 403;
  if (message.includes("Invalid job status transition") || message.includes("already final")) return 409;
  return 400;
}

export async function GET(request: Request, { params }: Params) {
  const auth = await requireUser(request);
  if (auth instanceof Response) return auth;

  const { data, error } = await auth.userClient
    .from("job_progress")
    .select("*, user:profiles!job_progress_updated_by_fkey(id, first_name, last_name, role)")
    .eq("job_id", params.jobId)
    .order("created_at", { ascending: true });

  if (error) return fail("Could not load progress", 400, error.message);
  return ok({ timeline: data });
}

export async function POST(request: Request, { params }: Params) {
  const auth = await requireUser(request);
  if (auth instanceof Response) return auth;

  const body = progressSchema.safeParse(await request.json());
  if (!body.success) return fail("Invalid progress payload", 422, body.error.flatten());

  const { data, error } = await auth.userClient.rpc("add_job_progress", {
    p_job_id: params.jobId,
    p_status: body.data.status,
    p_note: body.data.note ?? null
  });

  if (error) {
    return fail("Could not add progress", progressErrorStatus(error.message), error.message);
  }

  return created({ progress: data });
}
