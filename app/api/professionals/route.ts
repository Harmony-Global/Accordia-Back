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
  bio?: string | null;
  location?: string | null;
  state?: string | null;
  is_available: boolean;
  profile?: {
    first_name?: string | null;
    last_name?: string | null;
    is_active?: boolean;
  } | null;
  professional_categories?: SearchCategoryLink[] | null;
  professional_services?: SearchService[] | null;
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

  return ok({ professionals });
}
