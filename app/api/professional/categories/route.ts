import { fail, ok } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { setCategoriesSchema } from "@/lib/validators";

export async function GET(request: Request) {
  const auth = await requireRole(request, ["professional"]);
  if (auth instanceof Response) return auth;

  const { data: professionalProfile, error: profileError } = await auth.adminClient
    .from("professional_profiles")
    .select("id, professional_categories(category:categories(*))")
    .eq("user_id", auth.userId)
    .single();

  if (profileError) return fail("Professional profile not found", 404, profileError.message);
  const categories = (professionalProfile.professional_categories ?? []).map(
    (row: { category: unknown }) => row.category
  );

  return ok({ categories });
}

export async function PUT(request: Request) {
  const auth = await requireRole(request, ["professional"]);
  if (auth instanceof Response) return auth;

  const body = setCategoriesSchema.safeParse(await request.json());
  if (!body.success) return fail("Invalid category payload", 422, body.error.flatten());

  const { data: professionalProfile, error: profileError } = await auth.adminClient
    .from("professional_profiles")
    .select("id")
    .eq("user_id", auth.userId)
    .single();

  if (profileError) return fail("Professional profile not found", 404, profileError.message);

  const { error: deleteError } = await auth.adminClient
    .from("professional_categories")
    .delete()
    .eq("professional_id", professionalProfile.id);

  if (deleteError) return fail("Could not reset categories", 400, deleteError.message);

  const rows = body.data.category_ids.map((categoryId) => ({
    professional_id: professionalProfile.id,
    category_id: categoryId
  }));

  const { error: insertError } = await auth.adminClient.from("professional_categories").insert(rows);
  if (insertError) return fail("Could not save categories", 400, insertError.message);

  return ok({ updated: true });
}
