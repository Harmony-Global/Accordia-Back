import { fail, ok } from "@/lib/api";
import { requireUser } from "@/lib/auth";

export async function GET(request: Request) {
  const auth = await requireUser(request);
  if (auth instanceof Response) return auth;

  const { data, error } = await auth.userClient
    .from("categories")
    .select("*")
    .eq("is_active", true)
    .order("sort_order");

  if (error) return fail("Could not load categories", 400, error.message);
  return ok({ categories: data });
}
