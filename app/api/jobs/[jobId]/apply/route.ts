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
  return created({ application_id: data });
}
