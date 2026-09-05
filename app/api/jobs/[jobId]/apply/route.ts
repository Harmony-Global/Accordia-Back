import { created, fail } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { applySchema } from "@/lib/validators";

type Params = { params: { jobId: string } };

export async function POST(request: Request, { params }: Params) {
  const auth = await requireRole(request, ["professional"]);
  if (auth instanceof Response) return auth;

  const body = applySchema.safeParse(await request.json());
  if (!body.success) return fail("Invalid application payload", 422, body.error.flatten());

  const { data, error } = await auth.userClient.rpc("apply_to_job", {
    p_job_id: params.jobId,
    p_pitch: body.data.pitch,
    p_proposed_rate: body.data.proposed_rate ?? null
  });

  if (error) return fail("Could not apply to job", 400, error.message);
  const update: Record<string, unknown> = {};
  if (body.data.reference_image_urls?.length) update.reference_image_urls = body.data.reference_image_urls;
  if (body.data.estimated_days !== undefined) update.estimated_days = body.data.estimated_days;
  if (body.data.proposed_start_at !== undefined) update.proposed_start_at = body.data.proposed_start_at;

  if (Object.keys(update).length > 0) {
    const { error: referenceError } = await auth.adminClient
      .from("applications")
      .update(update)
      .eq("id", data)
      .eq("professional_id", auth.userId);

    if (referenceError) return fail("Application created, but proposal details could not be saved", 400, referenceError.message);
  }

  const { error: draftCleanupError } = await auth.adminClient
    .from("proposal_drafts")
    .delete()
    .eq("job_id", params.jobId)
    .eq("professional_id", auth.userId);
  if (draftCleanupError) console.warn("Could not delete sent proposal draft", draftCleanupError.message);

  return created({ application_id: data });
}
