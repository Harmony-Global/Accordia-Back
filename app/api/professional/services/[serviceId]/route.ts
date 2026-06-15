import { fail, ok } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { professionalServicePatchSchema } from "@/lib/validators";
import { z } from "zod";

type Params = { params: { serviceId: string } };
const serviceIdSchema = z.string().uuid();

export async function PATCH(request: Request, { params }: Params) {
  const auth = await requireRole(request, ["professional"]);
  if (auth instanceof Response) return auth;
  if (!serviceIdSchema.safeParse(params.serviceId).success) return fail("Invalid service ID", 422);

  const body = professionalServicePatchSchema.safeParse(await request.json());
  if (!body.success) return fail("Invalid professional service update", 422, body.error.flatten());
  if (Object.keys(body.data).length === 0) return fail("No service changes supplied", 422);

  const { data: currentService, error: currentError } = await auth.adminClient
    .from("professional_services")
    .select("price_min, price_max")
    .eq("id", params.serviceId)
    .eq("professional_id", auth.userId)
    .single();

  if (currentError || !currentService) return fail("Professional service not found", 404, currentError?.message);

  const priceMin = body.data.price_min ?? currentService.price_min;
  const priceMax = body.data.price_max ?? currentService.price_max;
  if (priceMax < priceMin) return fail("Maximum price must be greater than or equal to minimum price", 422);

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
    if (!count) return fail("Select this category on your professional profile before using it for a service", 422);
  }

  const { data: service, error } = await auth.adminClient
    .from("professional_services")
    .update(body.data)
    .eq("id", params.serviceId)
    .eq("professional_id", auth.userId)
    .select("*, category:categories(*)")
    .single();

  if (error) return fail("Could not update professional service", 400, error.message);
  return ok({ service });
}

export async function DELETE(request: Request, { params }: Params) {
  const auth = await requireRole(request, ["professional"]);
  if (auth instanceof Response) return auth;
  if (!serviceIdSchema.safeParse(params.serviceId).success) return fail("Invalid service ID", 422);

  const { data: service, error } = await auth.adminClient
    .from("professional_services")
    .delete()
    .eq("id", params.serviceId)
    .eq("professional_id", auth.userId)
    .select("id")
    .single();

  if (error || !service) return fail("Professional service not found", 404, error?.message);
  return ok({ deleted: true, service_id: service.id });
}
