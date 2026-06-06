import { fail, ok, parseSearchParams } from "@/lib/api";
import { requireUser } from "@/lib/auth";

export async function GET(request: Request) {
  const auth = await requireUser(request);
  if (auth instanceof Response) return auth;

  const params = parseSearchParams(request);
  const unreadOnly = params.get("unread") === "true";

  let query = auth.userClient
    .from("notifications")
    .select("*")
    .eq("user_id", auth.userId)
    .order("created_at", { ascending: false })
    .limit(50);

  if (unreadOnly) query = query.eq("is_read", false);

  const { data, error } = await query;
  if (error) return fail("Could not load notifications", 400, error.message);
  return ok({ notifications: data });
}
