import { fail, ok, parseSearchParams } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { payoutDateRange, payoutPage } from "@/lib/payouts";

export async function GET(request: Request) {
  const auth = await requireRole(request, ["client"]);
  if (auth instanceof Response) return auth;
  const params = parseSearchParams(request);
  const section = params.get("section") ?? "summary";
  if (section === "summary") {
    const { data, error } = await auth.adminClient.rpc("client_completed_payment_total", { p_client_id: auth.userId });
    if (error) return fail("Could not load payment total", 400, error.message);
    return ok({ summary: { ...data, total_kobo: Number(data.gross_kobo) - Number(data.refunded_kobo) } });
  }

  let range: ReturnType<typeof payoutDateRange>;
  let page: ReturnType<typeof payoutPage>;
  try {
    range = payoutDateRange(params);
    page = payoutPage(params);
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Invalid filters", 422);
  }

  if (section === "charges") {
    const { data, count, error } = await auth.adminClient.from("payments")
      .select("id,payment_type,amount,currency,status,paid_at,provider_reference,job:jobs(title),appointment:appointments(status,service:professional_services(title)),conversation:job_conversations(work_status)", { count: "exact" })
      .eq("payer_id", auth.userId).eq("provider", "paystack").eq("status", "success")
      .not("provider_transaction_id", "is", null).gte("paid_at", range.from).lt("paid_at", range.to)
      .order("paid_at", { ascending: false }).range(page.start, page.end);
    if (error) return fail("Could not load payments", 400, error.message);
    return ok({ charges: data ?? [], total: count ?? 0, page: page.page, page_size: page.size });
  }
  if (section === "refunds") {
    const { data, count, error } = await auth.adminClient.from("payment_refunds")
      .select("id,amount_kobo,currency,status,initiated_at,processed_at,payment:payments!inner(payer_id,payment_type,provider_reference,job:jobs(title),appointment:appointments(service:professional_services(title)))", { count: "exact" })
      .eq("payment.payer_id", auth.userId).gte("initiated_at", range.from).lt("initiated_at", range.to)
      .order("initiated_at", { ascending: false }).range(page.start, page.end);
    if (error) return fail("Could not load refunds", 400, error.message);
    return ok({ refunds: (data ?? []).map(({ payment, ...refund }) => {
      const details = Array.isArray(payment) ? payment[0] : payment;
      if (!details) return refund;
      const { payer_id: _payerId, ...safePayment } = details;
      return { ...refund, payment: safePayment };
    }), total: count ?? 0, page: page.page, page_size: page.size });
  }
  return fail("Unknown payment section", 422);
}
