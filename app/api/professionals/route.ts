import { fail, ok, parseSearchParams } from "@/lib/api";
import { requireRole } from "@/lib/auth";

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
      professional_services(id, professional_id, category_id, offering_type, title, description, image_url, price_min, price_max, currency, is_active, created_at, updated_at, category:categories(id, name, slug, icon))
    `)
    .eq("is_available", true)
    .order("updated_at", { ascending: false })
    .limit(80);

  if (error) return fail("Could not load professionals", 400, error.message);

  const professionals = (data ?? [])
    .map((professional) => {
      const activeServices = (professional.professional_services ?? []).filter((service: SearchService) => service.is_active);
      return {
        ...professional,
        professional_services: activeServices
      } as SearchProfessional;
    })
    .filter((professional) => professional.profile?.is_active !== false)
    .filter((professional) => !state || normalize(professional.state ?? professional.location ?? "").includes(state))
    .filter((professional) => {
      if (!categoryId) return true;
      const categoryMatch = (professional.professional_categories ?? []).some((item) => categoryValue(item)?.id === categoryId);
      const serviceMatch = (professional.professional_services ?? []).some((service) => service.category_id === categoryId);
      return categoryMatch || serviceMatch;
    })
    .filter((professional) => professionalMatchesQuery(professional, query));

  const professionalIds = [...new Set(professionals.flatMap((professional) => professionalRatingIds(professional)))];
  const ratingSummaries = new Map<string, ProfessionalRatingSummary>();

  if (professionalIds.length > 0) {
    const { data: reviews, error: reviewsError } = await auth.adminClient
      .from("conversation_reviews")
      .select("professional_id, rating")
      .in("professional_id", professionalIds)
      .eq("skipped", false)
      .not("rating", "is", null);

    if (reviewsError) return fail("Could not load professional ratings", 400, reviewsError.message);

    for (const review of reviews ?? []) {
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

  return ok({
    professionals: professionals.map((professional) => ({
      ...professional,
      ...getProfessionalRatingSummary(professional, ratingSummaries)
    }))
  });
}
