import { fail, ok, parseSearchParams } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { proposalDraftSchema } from "@/lib/validators";

export async function GET(request: Request) {
  const auth = await requireRole(request, ["professional"]);
  if (auth instanceof Response) return auth;

  const jobId = parseSearchParams(request).get("job_id");
  if (!jobId) return fail("job_id is required", 422);

  const { data, error } = await auth.adminClient
    .from("proposal_drafts")
    .select("*")
    .eq("job_id", jobId)
    .eq("professional_id", auth.userId)
    .maybeSingle();

  if (error) return fail("Could not load proposal draft", 400, error.message);
  return ok({ draft: data ?? null });
}

export async function PUT(request: Request) {
  const auth = await requireRole(request, ["professional"]);
  if (auth instanceof Response) return auth;

  const body = proposalDraftSchema.safeParse(await request.json());
  if (!body.success) return fail("Invalid proposal draft payload", 422, body.error.flatten());

  const { data: job, error: jobError } = await auth.adminClient
    .from("jobs")
    .select("id")
    .eq("id", body.data.job_id)
    .single();

  if (jobError || !job) return fail("Job not found", 404, jobError?.message);

  const { data, error } = await auth.adminClient
    .from("proposal_drafts")
    .upsert({
      job_id: body.data.job_id,
      professional_id: auth.userId,
      pitch: body.data.pitch ?? null,
      proposed_rate: body.data.proposed_rate ?? null,
      estimated_days: body.data.estimated_days ?? null,
      proposed_start_at: body.data.proposed_start_at ?? null,
      reference_image_urls: body.data.reference_image_urls ?? []
    }, { onConflict: "job_id,professional_id" })
    .select("*")
    .single();

  if (error) return fail("Could not save proposal draft", 400, error.message);
  return ok({ draft: data });
}
