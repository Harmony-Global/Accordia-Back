import { fail, ok } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { setCategoriesSchema } from "@/lib/validators";

export async function GET(request: Request) {
  const auth = await requireRole(request, ["professional"]);
  if (auth instanceof Response) return auth;

  const { data: professionalProfile, error: profileError } = await auth.adminClient
    .from("professional_profiles")
    .select("id, professional_categories(category:categories(*)), professional_main_categories(category:categories(*))")
    .eq("user_id", auth.userId)
    .single();

  if (profileError) return fail("Professional profile not found", 404, profileError.message);
  const categories = (professionalProfile.professional_categories ?? []).map(
    (row: { category: unknown }) => row.category
  );

  const mainCategories = (professionalProfile.professional_main_categories ?? []).map(
    (row: { category: unknown }) => row.category
  );
  return ok({ categories, main_categories: mainCategories });
}

export async function PUT(request: Request) {
  const auth = await requireRole(request, ["professional"]);
  if (auth instanceof Response) return auth;

  const body = setCategoriesSchema.safeParse(await request.json());
  if (!body.success) return fail("Invalid category payload", 422, body.error.flatten());

  const { error } = await auth.adminClient.rpc("set_professional_category_selection", {
    p_user_id: auth.userId,
    p_main_ids: body.data.main_category_ids,
    p_category_ids: body.data.category_ids
  });
  if (error) return fail("Could not save categories", 422, error.message);

  return ok({ updated: true });
}
