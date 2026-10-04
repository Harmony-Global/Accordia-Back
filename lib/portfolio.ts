import type { SupabaseClient } from "@supabase/supabase-js";

export const portfolioBucket = "professional-portfolio";

export async function signedPortfolio(adminClient: SupabaseClient, professionalId: string) {
  const { data, error } = await adminClient.from("professional_portfolio")
    .select("id, professional_id, title, description, file_path, mime_type, created_at, updated_at")
    .eq("professional_id", professionalId).order("created_at", { ascending: false });
  if (error) throw error;
  return Promise.all((data ?? []).map(async (entry) => {
    const { data: signed, error: signError } = await adminClient.storage.from(portfolioBucket)
      .createSignedUrl(entry.file_path, 3600);
    if (signError) throw signError;
    return { ...entry, file_url: signed.signedUrl };
  }));
}
