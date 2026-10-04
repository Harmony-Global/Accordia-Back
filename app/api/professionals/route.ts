import { fail, ok, parseSearchParams } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { signedPortfolio } from "@/lib/portfolio";

type SearchCategoryLink = {
  category?: {
    id: string;
    name: string;
    slug: string;
  } | {
    id: string;
    name: string;
    slug: string;
  }[] | null;
};

type SearchService = {
  is_active: boolean;
  is_visible_on_profile?: boolean;
  archived_at?: string | null;
  activity_anchor_at?: string | null;
  offering_type?: string;
  title?: string | null;
  description?: string | null;
  category_id?: string | null;
};

type SearchProfessional = {
  id?: string;
  user_id?: string;
  bio?: string | null;
  location?: string | null;
  state?: string | null;
  is_available: boolean;
  profile?: {
    id?: string | null;
    first_name?: string | null;
    last_name?: string | null;
    is_active?: boolean;
  } | null;
  professional_categories?: SearchCategoryLink[] | null;
  professional_services?: SearchService[] | null;
};

type ProfessionalRatingSummary = {
  rating_average: number | null;
  review_count: number;
};

function normalize(value: string | null) {
  return value?.trim().toLowerCase() ?? "";
}

function categoryValue(link: SearchCategoryLink) {
  return Array.isArray(link.category) ? link.category[0] : link.category;
}

function professionalMatchesQuery(professional: SearchProfessional, query: string) {
  if (!query) return true;

  const searchable = [
    professional.profile?.first_name,
    professional.profile?.last_name,
    professional.bio,
    professional.location,
    professional.state,
    ...(professional.professional_categories ?? []).map((item) => categoryValue(item)?.name),
    ...(professional.professional_services ?? []).map((service) => service.title),
    ...(professional.professional_services ?? []).map((service) => service.description)
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return searchable.includes(query);
}

function emptyRatingSummary(): ProfessionalRatingSummary {
  return {
    rating_average: null,
    review_count: 0
  };
}

function professionalRatingIds(professional: SearchProfessional) {
  return [professional.user_id, professional.profile?.id, professional.id].filter(Boolean) as string[];
}

function getProfessionalRatingSummary(professional: SearchProfessional, ratingSummaries: Map<string, ProfessionalRatingSummary>) {
  for (const id of professionalRatingIds(professional)) {
    const summary = ratingSummaries.get(id);
    if (summary) return summary;
  }

  return emptyRatingSummary();
}

export async function GET(request: Request) {
  const auth = await requireRole(request, ["client", "admin"]);
  if (auth instanceof Response) return auth;

  const params = parseSearchParams(request);
  const query = normalize(params.get("q"));
  const categoryId = params.get("category_id");
  const state = normalize(params.get("state"));
  const categoryIds = new Set<string>(categoryId ? [categoryId] : []);
  if (categoryId) {
    const { data: tree, error: treeError } = await auth.adminClient.from("categories")
      .select("id, parent_id, level").eq("is_active", true);
    if (treeError) return fail("Could not load category filters", 400, treeError.message);
    for (let depth = 0; depth < 2; depth += 1) {
      for (const category of tree ?? []) {
        if (category.parent_id && categoryIds.has(category.parent_id)) categoryIds.add(category.id);
      }
    }
  }

  const { data, error } = await auth.adminClient
    .from("professional_profiles")
    .select(`
      id,
      user_id,
      bio,
      years_experience,
      location,
      state,
      is_available,
      updated_at,
      profile:profiles!professional_profiles_user_id_fkey(id, first_name, last_name, avatar_url, phone_verified, is_active),
      professional_categories(category:categories(id, name, slug, icon)),
      professional_main_categories(category:categories(id, name, slug, icon)),
      professional_services(id, professional_id, category_id, offering_type, title, description, image_url, price_min, price_max, currency, is_active, is_visible_on_profile, archived_at, activity_anchor_at, created_at, updated_at, category:categories(id, name, slug, icon, level, parent_id))
    `)
    .eq("is_available", true)
    .order("updated_at", { ascending: false })
    .limit(80);

  if (error) return fail("Could not load professionals", 400, error.message);

  const professionals = (data ?? [])
    .map((professional) => {
      const activeServices = (professional.professional_services ?? []).filter((service: SearchService) =>
        service.is_active && service.is_visible_on_profile && !service.archived_at
        && (service.offering_type === "product" || Boolean(service.activity_anchor_at
          && new Date(service.activity_anchor_at).getTime() > Date.now() - 90 * 86400000)));
      return {
        ...professional,
        professional_services: activeServices
      } as SearchProfessional;
    })
    .filter((professional) => professional.profile?.is_active !== false)
    .filter((professional) => !state || normalize(professional.state ?? professional.location ?? "").includes(state))
    .filter((professional) => {
      if (!categoryId) return true;
      const categoryMatch = (professional.professional_categories ?? []).some((item) =>
        categoryIds.has(categoryValue(item)?.id ?? ""));
      const serviceMatch = (professional.professional_services ?? []).some((service) =>
        categoryIds.has(service.category_id ?? ""));
      return categoryMatch || serviceMatch;
    })
    .filter((professional) => professionalMatchesQuery(professional, query));

  const professionalIds = [...new Set(professionals.flatMap((professional) => professionalRatingIds(professional)))];
  const ratingSummaries = new Map<string, ProfessionalRatingSummary>();

  if (professionalIds.length > 0) {
    const [jobResult, appointmentResult] = await Promise.all([
      auth.adminClient.from("conversation_reviews")
        .select("professional_id, rating")
        .in("professional_id", professionalIds)
        .eq("skipped", false)
        .not("rating", "is", null),
      auth.adminClient.from("appointment_reviews")
        .select("professional_id, rating")
        .in("professional_id", professionalIds)
        .eq("skipped", false)
        .not("rating", "is", null)
    ]);
    if (jobResult.error || appointmentResult.error) {
      return fail("Could not load professional ratings", 400, jobResult.error?.message ?? appointmentResult.error?.message);
    }

    for (const review of [...(jobResult.data ?? []), ...(appointmentResult.data ?? [])]) {
      const professionalId = review.professional_id as string;
      const rating = Number(review.rating);
      if (!professionalId || Number.isNaN(rating)) continue;

      const current = ratingSummaries.get(professionalId) ?? emptyRatingSummary();
      const total = (current.rating_average ?? 0) * current.review_count + rating;
      const reviewCount = current.review_count + 1;
      ratingSummaries.set(professionalId, {
        rating_average: Number((total / reviewCount).toFixed(1)),
        review_count: reviewCount
      });
    }
  }

  let portfolios: Awaited<ReturnType<typeof signedPortfolio>>[];
  try {
    portfolios = await Promise.all(professionals.map((professional) => signedPortfolio(auth.adminClient, professional.user_id ?? "")));
  } catch (portfolioError) {
    return fail("Could not load portfolios", 400, String(portfolioError));
  }

  return ok({
    professionals: professionals.map((professional, index) => ({
      ...professional,
      portfolio: portfolios[index],
      ...getProfessionalRatingSummary(professional, ratingSummaries)
    }))
  });
}
