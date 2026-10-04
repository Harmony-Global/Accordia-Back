import { fail, ok } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { professionalServicePatchSchema } from "@/lib/validators";
import { validateServiceCategory, validUploadedImages } from "@/lib/service-category";
import { z } from "zod";

type Params = { params: { serviceId: string } };
const serviceIdSchema = z.string().uuid();

export async function GET(request: Request, { params }: Params) {
  const auth = await requireRole(request, ["professional"]);
  if (auth instanceof Response) return auth;
  if (!serviceIdSchema.safeParse(params.serviceId).success) return fail("Invalid service ID", 422);
  const { data: service, error } = await auth.adminClient.from("professional_services")
    .select("*, category:categories(*), images:professional_service_images(image_url, position)")
    .eq("id", params.serviceId).eq("professional_id", auth.userId).is("archived_at", null).single();
  if (error || !service) return fail("Service not found", 404);
  const [views, requests, completed, reviews, profile] = await Promise.all([
    auth.adminClient.from("professional_profile_views").select("id", { count: "exact", head: true }).eq("professional_id", auth.userId),
    auth.adminClient.from("appointments").select("id", { count: "exact", head: true }).eq("service_id", service.id),
    auth.adminClient.from("appointments").select("id", { count: "exact", head: true }).eq("service_id", service.id).eq("status", "completed"),
    auth.adminClient.from("appointment_reviews").select("id, rating, review_text, created_at, client:profiles!appointment_reviews_client_id_fkey(first_name, last_name, avatar_url), appointment:appointments!inner(service_id)")
      .eq("appointment.service_id", service.id).eq("skipped", false).order("created_at", { ascending: false }).limit(5),
    auth.adminClient.from("profiles").select("first_name, last_name, avatar_url, phone_verified").eq("id", auth.userId).single()
  ]);
  const metricError = views.error ?? requests.error ?? completed.error ?? reviews.error ?? profile.error;
  if (metricError) return fail("Could not load service details", 400, metricError.message);
  return ok({ service, professional: profile.data, metrics: {
    profile_views: views.count ?? 0, requests: requests.count ?? 0, completed: completed.count ?? 0
  }, reviews: reviews.data ?? [] });
}

export async function PATCH(request: Request, { params }: Params) {
  const auth = await requireRole(request, ["professional"]);
  if (auth instanceof Response) return auth;
  if (!serviceIdSchema.safeParse(params.serviceId).success) return fail("Invalid service ID", 422);

  const body = professionalServicePatchSchema.safeParse(await request.json());
  if (!body.success) return fail("Invalid professional service update", 422, body.error.flatten());
  if (Object.keys(body.data).length === 0) return fail("No service changes supplied", 422);

  const { data: currentService, error: currentError } = await auth.adminClient
    .from("professional_services")
    .select("price_min, price_max, is_active, image_url, category_id, archived_at")
    .eq("id", params.serviceId)
    .eq("professional_id", auth.userId)
    .single();

  if (currentError || !currentService || currentService.archived_at) return fail("Professional service not found", 404, currentError?.message);

  const fixedPrice = body.data.price_min ?? body.data.price_max;
  const priceMin = fixedPrice ?? currentService.price_min;
  const priceMax = fixedPrice ?? currentService.price_max;
  if (priceMax < priceMin) return fail("Maximum price must be greater than or equal to minimum price", 422);
  if (priceMax !== priceMin) return fail("Professional services must use one fixed price", 422);

  const categoryError = body.data.category_id === undefined || body.data.category_id === currentService.category_id
    ? null : await validateServiceCategory(auth, body.data.category_id);
  if (categoryError) return fail(categoryError, 422);
  const imageUrls = body.data.image_urls;
  if (imageUrls && (!validUploadedImages(auth.userId, imageUrls)
    || (body.data.image_url && imageUrls[0] !== body.data.image_url))) {
    return fail("Choose one to five images uploaded to your account", 422);
  }

  const { image_urls: _imageUrls, ...changes } = body.data;
  const statusChange = body.data.is_active === undefined ? {} : body.data.is_active
    ? (!currentService.is_active ? { pause_reason: null, activity_anchor_at: new Date().toISOString() } : {})
    : { pause_reason: "manual" };

  const { data: service, error } = await auth.adminClient
    .from("professional_services")
    .update(
      body.data.price_min !== undefined
        ? { ...changes, ...statusChange, price_max: body.data.price_min, image_url: imageUrls?.[0] ?? changes.image_url }
        : body.data.price_max !== undefined
          ? { ...changes, ...statusChange, price_min: body.data.price_max, image_url: imageUrls?.[0] ?? changes.image_url }
          : { ...changes, ...statusChange, image_url: imageUrls?.[0] ?? changes.image_url }
    )
    .eq("id", params.serviceId)
    .eq("professional_id", auth.userId)
    .select("*, category:categories(*), images:professional_service_images(image_url, position)")
    .single();

  if (error) return fail("Could not update professional service", 400, error.message);
  if (imageUrls) {
    const { error: imagesError } = await auth.userClient.rpc("replace_professional_service_images", {
      p_service_id: service.id, p_urls: imageUrls
    });
    if (imagesError) return fail("Service saved, but images could not be updated", 400, imagesError.message);
    return ok({ service: { ...service, images: imageUrls.map((image_url, position) => ({ image_url, position })) } });
  }
  return ok({ service });
}

export async function DELETE(request: Request, { params }: Params) {
  const auth = await requireRole(request, ["professional"]);
  if (auth instanceof Response) return auth;
  if (!serviceIdSchema.safeParse(params.serviceId).success) return fail("Invalid service ID", 422);

  const { data: existing, error: existingError } = await auth.adminClient.from("professional_services")
    .select("id").eq("id", params.serviceId).eq("professional_id", auth.userId).is("archived_at", null).single();
  if (existingError || !existing) return fail("Professional service not found", 404);
  const links = await Promise.all(["appointments", "professional_availability", "professional_inquiries"].map((table) =>
    auth.adminClient.from(table).select("id", { count: "exact", head: true }).eq("service_id", params.serviceId)
  ));
  const linkError = links.find((result) => result.error)?.error;
  if (linkError) return fail("Could not check service history", 400, linkError.message);
  const archived = links.some((result) => (result.count ?? 0) > 0);
  const query = archived
    ? auth.adminClient.from("professional_services").update({ archived_at: new Date().toISOString(), is_active: false, is_visible_on_profile: false })
    : auth.adminClient.from("professional_services").delete();
  const { data: service, error } = await query.eq("id", params.serviceId).eq("professional_id", auth.userId).select("id").single();
  if (error || !service) return fail("Could not remove service", 400, error?.message);
  return ok({ deleted: true, archived, service_id: service.id });
}
