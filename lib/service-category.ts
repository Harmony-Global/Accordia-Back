import type { AuthContext } from "@/lib/auth";
import { env } from "@/lib/env";

export async function validateServiceCategory(auth: AuthContext, categoryId: string | null | undefined) {
  if (!categoryId) return null;

  const { data: category, error } = await auth.adminClient.from("categories")
    .select("id, level, parent_id, created_by, is_active")
    .eq("id", categoryId).single();
  if (error || !category?.is_active) return "Choose an available category";

  const { data: profile, error: profileError } = await auth.adminClient
    .from("professional_profiles").select("id").eq("user_id", auth.userId).single();
  if (profileError || !profile) return "Professional profile not found";

  const selectedId = category.level === "service" ? category.parent_id : category.id;
  if (category.level === "service" && category.created_by !== auth.userId) {
    return "You can only use Service Categories you created";
  }
  if (!selectedId || !["service", "sub", "legacy"].includes(category.level)) {
    return "Choose a subcategory or Service Category";
  }
  const { count, error: selectedError } = await auth.adminClient.from("professional_categories")
    .select("category_id", { count: "exact", head: true })
    .eq("professional_id", profile.id).eq("category_id", selectedId);
  if (selectedError) return "Could not validate the selected category";
  if (!count) return "Select the parent category on your professional profile first";
  return null;
}

export function validUploadedImages(userId: string, urls: string[]) {
  const marker = `/storage/v1/object/public/professional-service-images/${userId}/`;
  return urls.length >= 1 && urls.length <= 5 && new Set(urls).size === urls.length
    && urls.every((url) => {
      try {
        const parsed = new URL(url);
        return parsed.origin === new URL(env.supabaseUrl).origin && parsed.pathname.startsWith(marker);
      } catch {
        return false;
      }
    });
}
