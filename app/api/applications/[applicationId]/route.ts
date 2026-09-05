import { fail, ok } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { applicationPatchSchema } from "@/lib/validators";

type Params = { params: { applicationId: string } };

export async function PATCH(request: Request, { params }: Params) {
  const auth = await requireRole(request, ["professional"]);
  if (auth instanceof Response) return auth;

  const body = applicationPatchSchema.safeParse(await request.json());
  if (!body.success) return fail("Invalid application update payload", 422, body.error.flatten());

  const update: Record<string, unknown> = {};
  if (body.data.pitch !== undefined) update.pitch = body.data.pitch;
  if (body.data.proposed_rate !== undefined) update.proposed_rate = body.data.proposed_rate;
  if (body.data.estimated_days !== undefined) update.estimated_days = body.data.estimated_days;
  if (body.data.proposed_start_at !== undefined) update.proposed_start_at = body.data.proposed_start_at;
  if (body.data.reference_image_urls !== undefined) update.reference_image_urls = body.data.reference_image_urls;

  const { data, error } = await auth.adminClient
    .from("applications")
    .update(update)
    .eq("id", params.applicationId)
    .eq("professional_id", auth.userId)
    .is("deleted_at", null)
    .in("status", ["pending", "reviewed", "shortlisted"])
    .select("*, job:jobs(*, category:categories(*), client:profiles!jobs_client_id_fkey(id, first_name, last_name, phone_verified))")
    .single();

  if (error) return fail("Could not update application", 400, error.message);
  return ok({ application: data });
}

export async function DELETE(request: Request, { params }: Params) {
  const auth = await requireRole(request, ["professional"]);
  if (auth instanceof Response) return auth;

  const { data, error } = await auth.userClient.rpc("soft_delete_application", {
    p_application_id: params.applicationId
  });

  if (error) {
    const status = error.message.includes("Only inactive applications") ? 409 : error.message.includes("not found") ? 404 : 400;
    return fail("Could not delete application", status, error.message);
  }

  return ok(data);
}
