import { fail, ok, parseSearchParams } from "@/lib/api";
import { requireRole } from "@/lib/auth";

export async function GET(request: Request) {
  const auth = await requireRole(request, ["admin"]);
  if (auth instanceof Response) return auth;

  const params = parseSearchParams(request);
  const role = params.get("role");
  const isActive = params.get("is_active");
  const limit = Math.min(Number(params.get("limit") ?? 50), 100);
  const offset = Number(params.get("offset") ?? 0);

  let query = auth.adminClient
    .from("profiles")
    .select("id,email,phone,role,first_name,last_name,phone_verified,is_active,created_at")
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (role) query = query.eq("role", role);
  if (isActive === "true" || isActive === "false") query = query.eq("is_active", isActive === "true");

  const { data, error } = await query;
  if (error) return fail("Could not load users", 400, error.message);
  return ok({ users: data });
}
