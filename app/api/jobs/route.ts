import { created, fail, ok, parseSearchParams } from "@/lib/api";
import { requireRole, requireUser } from "@/lib/auth";
import { createJobSchema } from "@/lib/validators";

export async function GET(request: Request) {
  const auth = await requireUser(request);
  if (auth instanceof Response) return auth;

  const params = parseSearchParams(request);
  const status = params.get("status");
  const mine = params.get("mine") === "true";

  let query = auth.userClient
    .from("jobs")
    .select("*, categories(*), client:profiles!jobs_client_id_fkey(id, first_name, last_name, phone_verified), applications(id, status)")
    .order("created_at", { ascending: false })
    .limit(50);

  if (mine) query = query.eq("client_id", auth.userId);
  if (status) query = query.eq("status", status);

  const { data, error } = await query;
  if (error) return fail("Could not load jobs", 400, error.message);
  return ok({ jobs: data });
}

export async function POST(request: Request) {
  const auth = await requireRole(request, ["client"]);
  if (auth instanceof Response) return auth;

  const body = createJobSchema.safeParse(await request.json());
  if (!body.success) return fail("Invalid job payload", 422, body.error.flatten());

  const { data: job, error } = await auth.adminClient
    .from("jobs")
    .insert({ ...body.data, client_id: auth.userId })
    .select("*")
    .single();

  if (error) return fail("Could not create job", 400, error.message);

  await auth.adminClient.from("job_progress").insert({
    job_id: job.id,
    status: "posted",
    note: "Client posted the job.",
    updated_by: auth.userId
  });

  return created({ job });
}
