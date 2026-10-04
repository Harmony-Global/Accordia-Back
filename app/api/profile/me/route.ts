import { fail, ok } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { professionalProfilePatchSchema, profilePatchSchema } from "@/lib/validators";
import { signedPortfolio } from "@/lib/portfolio";

export async function GET(request: Request) {
  const auth = await requireUser(request);
  if (auth instanceof Response) return auth;

  const { data: profile, error } = await auth.adminClient
    .from("profiles")
    .select(`
      id,
      email,
      phone,
      location,
      state,
      role,
      first_name,
      last_name,
      avatar_url,
      phone_verified,
      is_active,
      created_at,
      updated_at,
      professional_profiles(
        id,
        user_id,
        bio,
        years_experience,
        location,
        state,
        is_available,
        professional_categories(category:categories(id, name, slug, icon, description)),
        professional_main_categories(category:categories(id, name, slug, icon, description)),
        professional_services(id, professional_id, category_id, offering_type, title, description, image_url, price_min, price_max, currency, is_active, created_at, updated_at, category:categories(id, name, slug, icon))
      )
    `)
    .eq("id", auth.userId)
    .single();

  if (error) return fail("Could not load profile", 400, error.message);

  const professionalProfile = Array.isArray(profile.professional_profiles)
    ? profile.professional_profiles[0]
    : profile.professional_profiles;
  const activeServiceCount = professionalProfile?.professional_services?.filter(
    (service: { is_active: boolean }) => service.is_active
  ).length ?? 0;

  let rating_average: number | null = null;
  let review_count = 0;
  let portfolio: Awaited<ReturnType<typeof signedPortfolio>> = [];
  if (auth.role === "professional") {
    const [jobs, appointments] = await Promise.all([
      auth.adminClient.from("conversation_reviews").select("rating").eq("professional_id", auth.userId)
        .eq("skipped", false).not("rating", "is", null),
      auth.adminClient.from("appointment_reviews").select("rating").eq("professional_id", auth.userId)
        .eq("skipped", false).not("rating", "is", null)
    ]);
    if (jobs.error || appointments.error) return fail("Could not load ratings", 400, jobs.error?.message ?? appointments.error?.message);
    const ratings = [...(jobs.data ?? []), ...(appointments.data ?? [])].map((row) => Number(row.rating));
    review_count = ratings.length;
    if (ratings.length) rating_average = Number((ratings.reduce((sum, value) => sum + value, 0) / ratings.length).toFixed(1));
    try { portfolio = await signedPortfolio(auth.adminClient, auth.userId); }
    catch (portfolioError) { return fail("Could not load portfolio", 400, String(portfolioError)); }
  }

  return ok({
    profile,
    rating_average,
    review_count,
    portfolio,
    verification_progress: profile.phone_verified ? 100 : 0,
    professional_services_progress: auth.role === "professional"
      ? {
          service_count: activeServiceCount,
          minimum_required: 5,
          has_minimum_services: activeServiceCount >= 5
        }
      : null
  });
}

export async function PATCH(request: Request) {
  const auth = await requireUser(request);
  if (auth instanceof Response) return auth;

  const payload = await request.json();
  const profilePatch = profilePatchSchema.safeParse(payload.profile ?? {});
  const proPatch = professionalProfilePatchSchema.safeParse(payload.professional_profile ?? {});

  if (!profilePatch.success) return fail("Invalid profile payload", 422, profilePatch.error.flatten());
  if (!proPatch.success) return fail("Invalid professional profile payload", 422, proPatch.error.flatten());

  if (Object.keys(profilePatch.data).length > 0) {
    const { data: currentProfile, error: loadError } = await auth.adminClient
      .from("profiles")
      .select("phone")
      .eq("id", auth.userId)
      .single();

    if (loadError) return fail("Could not update profile", 400, loadError.message);

    const update: Record<string, string | boolean | null> = {};
    if (profilePatch.data.first_name !== undefined) update.first_name = profilePatch.data.first_name;
    if (profilePatch.data.last_name !== undefined) update.last_name = profilePatch.data.last_name;
    if (auth.role === "client") {
      if (profilePatch.data.location !== undefined) update.location = profilePatch.data.location;
      if (profilePatch.data.state !== undefined) update.state = profilePatch.data.state;
    }
    if (profilePatch.data.phone !== undefined) {
      update.phone = profilePatch.data.phone;
      if (profilePatch.data.phone !== currentProfile.phone) update.phone_verified = false;
    }
    if (Object.prototype.hasOwnProperty.call(profilePatch.data, "avatar_url")) {
      update.avatar_url = profilePatch.data.avatar_url ?? null;
    }

    const { error } = await auth.adminClient
      .from("profiles")
      .update(update)
      .eq("id", auth.userId)
      .eq("is_active", true);

    if (error) return fail("Could not update profile", 400, error.message);
  }

  if (auth.role === "professional" && Object.keys(proPatch.data).length > 0) {
    const { error } = await auth.adminClient
      .from("professional_profiles")
      .update(proPatch.data)
      .eq("user_id", auth.userId);
    if (error) return fail("Could not update professional profile", 400, error.message);
  }

  return ok({ updated: true });
}
