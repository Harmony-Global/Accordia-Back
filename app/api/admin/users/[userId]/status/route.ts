import { fail, ok } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { adminUserStatusSchema } from "@/lib/validators";

type Params = { params: { userId: string } };

export async function PATCH(request: Request, { params }: Params) {
  const auth = await requireRole(request, ["admin"]);
  if (auth instanceof Response) return auth;

  const body = adminUserStatusSchema.safeParse(await request.json());
  if (!body.success) return fail("Invalid user status payload", 422, body.error.flatten());
  if (params.userId === auth.userId && body.data.is_active === false) {
    return fail("Admins cannot deactivate their own account", 400);
  }

  const { data, error } = await auth.adminClient
    .from("profiles")
    .update({ is_active: body.data.is_active })
    .eq("id", params.userId)
    .select("id,email,phone,role,first_name,last_name,phone_verified,is_active,created_at")
    .single();

  if (error) return fail("Could not update user status", 400, error.message);
  return ok({ user: data });
}
