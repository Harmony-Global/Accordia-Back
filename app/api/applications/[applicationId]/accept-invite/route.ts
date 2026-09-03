import { fail, ok } from "@/lib/api";
import { requireRole } from "@/lib/auth";

type Params = { params: { applicationId: string } };

export async function POST(request: Request, { params }: Params) {
  const auth = await requireRole(request, ["professional", "admin"]);
  if (auth instanceof Response) return auth;

  const { data, error } = await auth.userClient.rpc("accept_application_invitation", {
    p_application_id: params.applicationId
  });

  if (error) return fail("Could not accept chat invitation", 400, error.message);
  return ok({ invitation: data });
}
