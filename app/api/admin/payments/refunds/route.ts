import { fail, ok, parseSearchParams } from "@/lib/api";
import { requireRole } from "@/lib/auth";

export async function GET(request: Request) {
  const auth = await requireRole(request, ["admin"]);
  if (auth instanceof Response) return auth;
  const page = Number(parseSearchParams(request).get("page") ?? "1");
  if (!Number.isInteger(page) || page < 1 || page > 100000) return fail("Invalid page", 422);
  const size = 20;
  const { data, count, error } = await auth.adminClient.from("payment_refunds")
    .select("id,provider_refund_id,amount_kobo,status,initiated_at,reconciled_at,reconciliation_note,payment:payments(id,professional_id,conversation_id,appointment_id,provider_reference)", { count: "exact" })
    .order("initiated_at", { ascending: false }).range((page - 1) * size, page * size - 1);
  if (error) return fail("Could not load refunds", 400, error.message);
  return ok({ refunds: data ?? [], total: count ?? 0, page, page_size: size });
}
