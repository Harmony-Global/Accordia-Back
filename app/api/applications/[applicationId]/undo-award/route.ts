import { fail, ok } from "@/lib/api";
import { requireRole } from "@/lib/auth";

type Params = { params: { applicationId: string } };

export async function POST(request: Request, { params }: Params) {
  const auth = await requireRole(request, ["client"]);
  if (auth instanceof Response) return auth;

  const { data, error } = await auth.userClient.rpc("undo_award_application", {
    p_application_id: params.applicationId
  });

  if (error) return fail("Could not undo award selection", 400, error.message);
  return ok({ application: data });
}
