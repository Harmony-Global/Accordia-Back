import { fail, ok } from "@/lib/api";
import { requireRole } from "@/lib/auth";

type Params = { params: { applicationId: string } };

export async function POST(request: Request, { params }: Params) {
  const auth = await requireRole(request, ["client", "admin"]);
  if (auth instanceof Response) return auth;

  const { data, error } = await auth.userClient.rpc("invite_application_to_chat", {
    p_application_id: params.applicationId
  });

  if (error) return fail("Could not invite professional to chat", 400, error.message);
  return ok({ invitation: data });
}
