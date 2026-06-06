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
  if (body.data.reference_image_urls !== undefined) update.reference_image_urls = body.data.reference_image_urls;

  const { data, error } = await auth.adminClient
    .from("applications")
    .update(update)
    .eq("id", params.applicationId)
    .eq("professional_id", auth.userId)
    .in("status", ["pending", "reviewed", "shortlisted"])
    .select("*, job:jobs(*, category:categories(*), client:profiles!jobs_client_id_fkey(id, first_name, last_name, phone_verified))")
    .single();

  if (error) return fail("Could not update application", 400, error.message);
  return ok({ application: data });
}
