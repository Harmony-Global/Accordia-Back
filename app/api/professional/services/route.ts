import { created, fail, ok, parseSearchParams } from "@/lib/api";
import { requireRole, requireUser } from "@/lib/auth";
import { professionalServiceCreateSchema } from "@/lib/validators";
import { validateServiceCategory, validUploadedImages } from "@/lib/service-category";
import { z } from "zod";

const MINIMUM_PROFILE_SERVICES = 5;
const professionalIdSchema = z.string().uuid();

function serviceProgress(serviceCount: number) {
  return {
    service_count: serviceCount,
    minimum_required: MINIMUM_PROFILE_SERVICES,
    has_minimum_services: serviceCount >= MINIMUM_PROFILE_SERVICES
  };
}

export async function GET(request: Request) {
  const auth = await requireUser(request);
  if (auth instanceof Response) return auth;

  const requestedProfessionalId = parseSearchParams(request).get("professional_id");
  const professionalId = requestedProfessionalId ?? (auth.role === "professional" ? auth.userId : null);

  if (!professionalId) return fail("professional_id is required", 422);
  if (!professionalIdSchema.safeParse(professionalId).success) return fail("Invalid professional_id", 422);

  let query = auth.adminClient
    .from("professional_services")
    .select("id, professional_id, category_id, offering_type, title, description, image_url, price_min, price_max, currency, is_active, is_visible_on_profile, archived_at, activity_anchor_at, pause_reason, created_at, updated_at, category:categories(id, name, slug, icon, level, parent_id), images:professional_service_images(image_url, position)")
    .eq("professional_id", professionalId)
    .is("archived_at", null)
    .order("created_at", { ascending: false });

  if (professionalId !== auth.userId && auth.role !== "admin") {
    query = query.eq("is_active", true).eq("is_visible_on_profile", true);
  }

  const { data: services, error } = await query;
  if (error) return fail("Could not load professional services", 400, error.message);

  return ok({
    services: professionalId !== auth.userId && auth.role !== "admin"
      ? (services ?? []).filter((service) => service.offering_type === "product"
        || new Date(service.activity_anchor_at).getTime() > Date.now() - 90 * 86400000)
      : services,
    ...serviceProgress((services ?? []).filter((service) => service.is_active).length)
  });
}

export async function POST(request: Request) {
  const auth = await requireRole(request, ["professional"]);
  if (auth instanceof Response) return auth;

  const body = professionalServiceCreateSchema.safeParse(await request.json());
  if (!body.success) return fail("Invalid professional service payload", 422, body.error.flatten());

  const categoryError = await validateServiceCategory(auth, body.data.category_id);
  if (categoryError) return fail(categoryError, 422);
  const imageUrls = body.data.image_urls ?? [body.data.image_url];
  if (!validUploadedImages(auth.userId, imageUrls) || imageUrls[0] !== body.data.image_url) {
    return fail("Choose one to five images uploaded to your account, with the cover image first", 422);
  }

  const { data: service, error } = await auth.adminClient
    .from("professional_services")
    .insert({
      ...body.data,
      image_urls: undefined,
      pause_reason: body.data.is_active ? null : "manual",
      professional_id: auth.userId
    })
    .select("id, professional_id, category_id, offering_type, title, description, image_url, price_min, price_max, currency, is_active, is_visible_on_profile, archived_at, activity_anchor_at, pause_reason, created_at, updated_at, category:categories(id, name, slug, icon, level, parent_id)")
    .single();

  if (error) return fail("Could not create professional service", 400, error.message);

  const { error: imagesError } = await auth.userClient.rpc("replace_professional_service_images", {
    p_service_id: service.id, p_urls: imageUrls
  });
  if (imagesError) {
    await auth.adminClient.from("professional_services").delete().eq("id", service.id);
    return fail("Could not save service images", 400, imagesError.message);
  }

  const { count, error: countError } = await auth.adminClient
    .from("professional_services")
    .select("id", { count: "exact", head: true })
    .eq("professional_id", auth.userId)
    .eq("is_active", true);

  if (countError) return fail("Service created, but profile progress could not be loaded", 400, countError.message);

  return created({
    service: { ...service, images: imageUrls.map((image_url, position) => ({ image_url, position })) },
    ...serviceProgress(count ?? 0)
  });
}
