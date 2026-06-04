import { created, fail, ok } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { progressSchema } from "@/lib/validators";

type Params = { params: { jobId: string } };

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

  const { data, error } = await auth.userClient
    .from("job_progress")
    .insert({
      job_id: params.jobId,
      status: body.data.status,
      note: body.data.note ?? null,
      updated_by: auth.userId
    })
    .select("*")
    .single();

  if (error) return fail("Could not add progress", 400, error.message);

  await auth.adminClient.from("jobs").update({ status: body.data.status }).eq("id", params.jobId);

  return created({ progress: data });
}
