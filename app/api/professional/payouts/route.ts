import { fail, ok, parseSearchParams } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { lastFridayCutoff, nextFridayCutoff, payoutDateRange, payoutPage } from "@/lib/payouts";

type Allocation = { earning_id: string; amount_kobo: number; payout: { status: string } | { status: string }[] | null };

export async function GET(request: Request) {
  const auth = await requireRole(request, ["professional"]);
  if (auth instanceof Response) return auth;
  const params = parseSearchParams(request);
  const section = params.get("section") ?? "summary";
  const { data: summary, error: summaryError } = await auth.adminClient.rpc("professional_payout_metrics", {
    p_professional_id: auth.userId, p_from: null, p_to: null
  });
  if (summaryError) return fail("Could not load payout overview", 400, summaryError.message);
  if (section === "summary") {
    const { data: eligible, error: eligibleError } = await auth.adminClient.rpc("professional_payout_metrics", {
      p_professional_id: auth.userId, p_from: null, p_to: lastFridayCutoff()
    });
    if (eligibleError) return fail("Could not load payout eligibility", 400, eligibleError.message);
    return ok({ summary, eligible_kobo: eligible.available_kobo, next_cutoff_at: nextFridayCutoff() });
  }

  let range: ReturnType<typeof payoutDateRange>;
  let page: ReturnType<typeof payoutPage>;
  try {
    range = payoutDateRange(params);
    page = payoutPage(params);
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Invalid filters", 422);
  }

  if (section === "earnings") {
    const { data: earnings, count, error } = await auth.adminClient.from("professional_earnings")
      .select("id,title,source_type,gross_kobo,fee_kobo,net_kobo,earned_at,hold_reason", { count: "exact" })
      .eq("professional_id", auth.userId).gte("earned_at", range.from).lt("earned_at", range.to)
      .order("earned_at", { ascending: false }).range(page.start, page.end);
    if (error) return fail("Could not load earnings", 400, error.message);
    const ids = (earnings ?? []).map((earning) => earning.id);
    let allocations: Allocation[] = [];
    if (ids.length) {
      const result = await auth.adminClient.from("payout_allocations")
        .select("earning_id,amount_kobo,payout:professional_payouts(status)").in("earning_id", ids);
      if (result.error) return fail("Could not load earning settlements", 400, result.error.message);
      allocations = (result.data ?? []) as Allocation[];
    }
    const rows = (earnings ?? []).map((earning) => {
      const paidKobo = allocations.filter((item) => item.earning_id === earning.id &&
        (Array.isArray(item.payout) ? item.payout[0]?.status : item.payout?.status) === "success")
        .reduce((sum, item) => sum + Number(item.amount_kobo), 0);
      return { ...earning, paid_kobo: paidKobo,
        status: paidKobo >= Number(earning.net_kobo) ? "paid_out" : paidKobo > 0 ? "partially_paid" : "pending" };
    });
    const { data: metrics, error: metricsError } = await auth.adminClient.rpc("professional_payout_metrics", {
      p_professional_id: auth.userId, p_from: range.from, p_to: range.to
    });
    if (metricsError) return fail("Could not load earning totals", 400, metricsError.message);
    return ok({ earnings: rows, total: count ?? 0, page: page.page, page_size: page.size, metrics });
  }

  if (section === "history") {
    const { data: payouts, count, error } = await auth.adminClient.from("professional_payouts")
      .select("id,provider_reference,amount_kobo,status,display_at,transferred_at,destination:payout_destinations(bank_name,account_last4)", { count: "exact" })
      .eq("professional_id", auth.userId).eq("status", "success")
      .gte("transferred_at", range.from).lt("transferred_at", range.to)
      .order("transferred_at", { ascending: false }).range(page.start, page.end);
    if (error) return fail("Could not load payout history", 400, error.message);
    return ok({ payouts: payouts ?? [], total: count ?? 0, page: page.page, page_size: page.size });
  }
  return fail("Unknown payout section", 422);
}
