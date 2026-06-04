import { fail, ok } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { verificationReviewSchema } from "@/lib/validators";

type Params = { params: { verificationId: string } };

export async function PATCH(request: Request, { params }: Params) {
  const auth = await requireRole(request, ["admin"]);
  if (auth instanceof Response) return auth;

  const body = verificationReviewSchema.safeParse(await request.json());
  if (!body.success) return fail("Invalid review payload", 422, body.error.flatten());

  const { data, error } = await auth.adminClient
    .from("verifications")
    .update({
      status: body.data.status,
      reviewed_by: auth.userId,
      reviewed_at: new Date().toISOString()
    })
    .eq("id", params.verificationId)
    .select("*")
    .single();

  if (error) return fail("Could not update verification", 400, error.message);

  if (data.type === "phone" && data.status === "verified") {
    await auth.adminClient.from("profiles").update({ phone_verified: true }).eq("id", data.user_id);
  }

  return ok({ verification: data });
}
