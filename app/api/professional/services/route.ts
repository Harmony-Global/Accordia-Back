import { created, fail, ok, parseSearchParams } from "@/lib/api";
import { requireRole, requireUser } from "@/lib/auth";
import { professionalServiceCreateSchema } from "@/lib/validators";
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
    .select("id, professional_id, category_id, offering_type, title, description, image_url, price_min, price_max, currency, is_active, created_at, updated_at, category:categories(id, name, slug, icon)")
    .eq("professional_id", professionalId)
    .order("created_at", { ascending: false });

  if (professionalId !== auth.userId && auth.role !== "admin") {
    query = query.eq("is_active", true);
  }

  const { data: services, error } = await query;
  if (error) return fail("Could not load professional services", 400, error.message);

  return ok({
    services,
    ...serviceProgress((services ?? []).filter((service) => service.is_active).length)
  });
}

export async function POST(request: Request) {
  const auth = await requireRole(request, ["professional"]);
  if (auth instanceof Response) return auth;

  const body = professionalServiceCreateSchema.safeParse(await request.json());
  if (!body.success) return fail("Invalid professional service payload", 422, body.error.flatten());

  if (body.data.category_id) {
    const { data: professionalProfile, error: profileError } = await auth.adminClient
      .from("professional_profiles")
      .select("id")
      .eq("user_id", auth.userId)
      .single();

    if (profileError || !professionalProfile) {
      return fail("Professional profile not found", 404, profileError?.message);
    }

    const { count, error: categoryError } = await auth.adminClient
      .from("professional_categories")
      .select("category_id", { count: "exact", head: true })
      .eq("professional_id", professionalProfile.id)
      .eq("category_id", body.data.category_id);

    if (categoryError) return fail("Could not validate service category", 400, categoryError.message);
    if (!count) return fail("Select this category on your professional profile before adding the service", 422);
  }

  const { data: service, error } = await auth.adminClient
    .from("professional_services")
    .insert({
      ...body.data,
      professional_id: auth.userId
    })
    .select("id, professional_id, category_id, offering_type, title, description, image_url, price_min, price_max, currency, is_active, created_at, updated_at, category:categories(id, name, slug, icon)")
    .single();

  if (error) return fail("Could not create professional service", 400, error.message);

  const { count, error: countError } = await auth.adminClient
    .from("professional_services")
    .select("id", { count: "exact", head: true })
    .eq("professional_id", auth.userId)
    .eq("is_active", true);

  if (countError) return fail("Service created, but profile progress could not be loaded", 400, countError.message);

  return created({
    service,
    ...serviceProgress(count ?? 0)
  });
}
