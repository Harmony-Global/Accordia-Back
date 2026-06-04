import { fail, ok } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { awardSchema } from "@/lib/validators";

type Params = { params: { applicationId: string } };

export async function POST(request: Request, { params }: Params) {
  const auth = await requireRole(request, ["client"]);
  if (auth instanceof Response) return auth;

  const body = awardSchema.safeParse(await request.json());
  if (!body.success) return fail("Invalid award payload", 422, body.error.flatten());

  const { data, error } = await auth.userClient.rpc("award_application", {
    p_application_id: params.applicationId,
    p_agreed_amount: body.data.agreed_amount ?? null
  });

  if (error) return fail("Could not award job", 400, error.message);
  return ok({ job_id: data });
}
