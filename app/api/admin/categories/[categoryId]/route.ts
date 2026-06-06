import { fail, ok } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { categoryWriteSchema } from "@/lib/validators";

type Params = { params: { categoryId: string } };

export async function PATCH(request: Request, { params }: Params) {
  const auth = await requireRole(request, ["admin"]);
  if (auth instanceof Response) return auth;

  const body = categoryWriteSchema.partial().safeParse(await request.json());
  if (!body.success) return fail("Invalid category payload", 422, body.error.flatten());

  const { data, error } = await auth.adminClient
    .from("categories")
    .update(body.data)
    .eq("id", params.categoryId)
    .select("*")
    .single();

  if (error) return fail("Could not update category", 400, error.message);
  return ok({ category: data });
}
