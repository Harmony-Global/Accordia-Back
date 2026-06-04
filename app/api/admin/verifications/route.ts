import { fail, ok } from "@/lib/api";
import { requireRole } from "@/lib/auth";

export async function GET(request: Request) {
  const auth = await requireRole(request, ["admin"]);
  if (auth instanceof Response) return auth;

  const { data, error } = await auth.adminClient
    .from("verifications")
    .select("*, user:profiles!verifications_user_id_fkey(id, first_name, last_name, phone, role)")
    .order("created_at", { ascending: false });

  if (error) return fail("Could not load verification queue", 400, error.message);
  return ok({ verifications: data });
}
