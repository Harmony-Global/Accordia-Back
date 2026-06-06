import { created, fail, ok } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { categoryWriteSchema } from "@/lib/validators";

export async function GET(request: Request) {
  const auth = await requireRole(request, ["admin"]);
  if (auth instanceof Response) return auth;

  const { data, error } = await auth.adminClient
    .from("categories")
    .select("*")
    .order("sort_order");

  if (error) return fail("Could not load categories", 400, error.message);
  return ok({ categories: data });
}

export async function POST(request: Request) {
  const auth = await requireRole(request, ["admin"]);
  if (auth instanceof Response) return auth;

  const body = categoryWriteSchema.safeParse(await request.json());
  if (!body.success) return fail("Invalid category payload", 422, body.error.flatten());

  const { data, error } = await auth.adminClient
    .from("categories")
    .insert(body.data)
    .select("*")
    .single();

  if (error) return fail("Could not create category", 400, error.message);
  return created({ category: data });
}
