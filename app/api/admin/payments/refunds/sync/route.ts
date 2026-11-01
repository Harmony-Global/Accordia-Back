import { fail, ok, parseSearchParams } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { syncPaystackRefundPage } from "@/lib/refunds";

export async function POST(request: Request) {
  const auth = await requireRole(request, ["admin"]);
  if (auth instanceof Response) return auth;
  const page = Number(parseSearchParams(request).get("page") ?? "1");
  if (!Number.isInteger(page) || page < 1 || page > 100000) return fail("Invalid page", 422);
  try {
    return ok(await syncPaystackRefundPage(auth.adminClient, page));
  } catch (error) {
    return fail("Could not sync Paystack refunds", 502, error instanceof Error ? error.message : undefined);
  }
}
