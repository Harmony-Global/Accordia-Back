import { fail, ok, parseSearchParams } from "@/lib/api";
import { requireRole } from "@/lib/auth";

export async function GET(request: Request) {
  const auth = await requireRole(request, ["professional"]);
  if (auth instanceof Response) return auth;

  const params = parseSearchParams(request);
  const status = params.get("status");

  let query = auth.userClient
    .from("applications")
    .select("*, job:jobs(*, category:categories(*), client:profiles!jobs_client_id_fkey(id, first_name, last_name, phone_verified))")
    .eq("professional_id", auth.userId)
    .order("created_at", { ascending: false })
    .limit(50);

  if (status) query = query.eq("status", status);

  const { data, error } = await query;
  if (error) return fail("Could not load applications", 400, error.message);
  return ok({ applications: data });
}
