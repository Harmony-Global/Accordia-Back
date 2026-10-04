import { created, fail } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { z } from "zod";

const schema = z.object({ parent_id: z.string().uuid(), name: z.string().trim().min(2).max(100) }).strict();

export async function POST(request: Request) {
  const auth = await requireRole(request, ["professional"]);
  if (auth instanceof Response) return auth;
  const body = schema.safeParse(await request.json());
  if (!body.success) return fail("Invalid Service Category", 422, body.error.flatten());

  const { data: parent, error: parentError } = await auth.adminClient.from("categories")
    .select("id, level, is_active").eq("id", body.data.parent_id).single();
  if (parentError || !parent || parent.level !== "sub" || !parent.is_active) {
    return fail("Choose an active subcategory", 422);
  }
  const { data: profile, error: profileError } = await auth.adminClient.from("professional_profiles")
    .select("id").eq("user_id", auth.userId).single();
  if (profileError || !profile) return fail("Professional profile not found", 404);
  const { count, error: selectedError } = await auth.adminClient.from("professional_categories")
    .select("category_id", { count: "exact", head: true })
    .eq("professional_id", profile.id).eq("category_id", parent.id);
  if (selectedError || !count) return fail("Select this subcategory on your profile first", 422);

  const { data: category, error } = await auth.adminClient.from("categories").insert({
    parent_id: parent.id, level: "service", created_by: auth.userId,
    name: body.data.name, slug: `custom-${crypto.randomUUID()}`
  }).select("*").single();
  if (error) return fail(error.code === "23505" ? "This Service Category already exists" : "Could not create Service Category", error.code === "23505" ? 409 : 400, error.message);
  return created({ category });
}
