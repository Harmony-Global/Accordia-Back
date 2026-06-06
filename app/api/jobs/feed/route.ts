import { fail, ok, parseSearchParams } from "@/lib/api";
import { requireRole } from "@/lib/auth";

export async function GET(request: Request) {
  const auth = await requireRole(request, ["professional"]);
  if (auth instanceof Response) return auth;

  const params = parseSearchParams(request);
  const state = params.get("state");

  const { data: professionalProfile, error: profileError } = await auth.adminClient
    .from("professional_profiles")
    .select("id, is_available, professional_categories(category_id)")
    .eq("user_id", auth.userId)
    .single();

  if (profileError) return fail("Professional profile not found", 404, profileError.message);
  if (!professionalProfile.is_available) return ok({ jobs: [] });

  const categoryIds = (professionalProfile.professional_categories ?? []).map(
    (row: { category_id: string }) => row.category_id
  );

  if (categoryIds.length === 0) return ok({ jobs: [] });

  let query = auth.adminClient
    .from("jobs")
    .select("*, categories(*), client:profiles!jobs_client_id_fkey(id, first_name, last_name, phone_verified)")
    .in("category_id", categoryIds)
    .eq("status", "open")
    .order("created_at", { ascending: false })
    .limit(50);

  if (state) query = query.eq("state", state);

  const { data, error } = await query;
  if (error) return fail("Could not load job feed", 400, error.message);
  return ok({ jobs: data });
}
