import { fail, ok } from "@/lib/api";
import { requireRole, requireUser } from "@/lib/auth";
import { applicationPatchSchema } from "@/lib/validators";

type Params = { params: { applicationId: string } };

export async function GET(request: Request, { params }: Params) {
  const auth = await requireUser(request);
  if (auth instanceof Response) return auth;

  const { data: application, error } = await auth.adminClient
    .from("applications")
    .select(`
      *,
      job:jobs(
        id,
        client_id,
        title,
        description,
        currency,
        location,
        state,
        is_remote,
        number_of_professionals,
        status,
        views_count,
        applications_count,
        price_type,
        price_amount,
        category:categories(id, name, slug, icon),
        client:profiles!jobs_client_id_fkey(id, first_name, last_name, phone_verified)
      ),
      professional:profiles!applications_professional_id_fkey(
        id,
        first_name,
        last_name,
        phone_verified,
        avatar_url,
        professional_profiles(
          id,
          user_id,
          bio,
          years_experience,
          location,
          state,
          is_available,
          professional_categories(category:categories(id, name, slug, icon)),
          professional_services(id, professional_id, category_id, offering_type, title, description, image_url, price_min, price_max, currency, is_active, created_at, updated_at, category:categories(id, name, slug, icon))
        )
      )
    `)
    .eq("id", params.applicationId)
    .is("deleted_at", null)
    .single();

  if (error || !application) return fail("Application not found", 404, error?.message);

  const ownsJob = application.job?.client_id === auth.userId;
  const ownsApplication = application.professional_id === auth.userId;
  if (auth.role !== "admin" && !ownsJob && !ownsApplication) return fail("Forbidden for this application", 403);

  return ok({ application });
}

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
