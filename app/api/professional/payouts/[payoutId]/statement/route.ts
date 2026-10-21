import { fail } from "@/lib/api";
import { requireRole } from "@/lib/auth";

type Params = { params: { payoutId: string } };

const escapeHtml = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, (char) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
})[char] ?? char);
const money = (kobo: number) => new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN" }).format(kobo / 100);

export async function GET(request: Request, { params }: Params) {
  const auth = await requireRole(request, ["professional", "admin"]);
  if (auth instanceof Response) return auth;
  const { data: payout, error } = await auth.adminClient.from("professional_payouts")
    .select("id,professional_id,provider_reference,amount_kobo,status,transferred_at,destination:payout_destinations(bank_name,account_last4,resolved_name)")
    .eq("id", params.payoutId).maybeSingle();
  if (error || !payout) return fail("Payout not found", 404);
  if (auth.role !== "admin" && payout.professional_id !== auth.userId) return fail("Forbidden", 403);
  if (payout.status !== "success") return fail("Statement is available after payout confirmation", 409);
  const { data: allocations, error: allocationsError } = await auth.adminClient.from("payout_allocations")
    .select("amount_kobo,earning:professional_earnings(title,source_type,earned_at)").eq("payout_id", payout.id);
  if (allocationsError) return fail("Could not load payout statement", 400, allocationsError.message);
  const destination = Array.isArray(payout.destination) ? payout.destination[0] : payout.destination;
  const date = payout.transferred_at ? new Date(payout.transferred_at).toLocaleDateString("en-NG", { timeZone: "Africa/Lagos", dateStyle: "long" }) : "Confirmed";
  const rows = (allocations ?? []).map((allocation) => {
    const earning = Array.isArray(allocation.earning) ? allocation.earning[0] : allocation.earning;
    return `<tr><td>${escapeHtml(earning?.title)}</td><td>${escapeHtml(earning?.source_type)}</td><td class="amount">${escapeHtml(money(Number(allocation.amount_kobo)))}</td></tr>`;
  }).join("");
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Accordia payout statement</title>
  <style>body{font:15px Arial,sans-serif;color:#304047;max-width:780px;margin:48px auto;padding:0 24px}h1{color:#196c88}small{color:#666}table{width:100%;border-collapse:collapse;margin-top:32px}th,td{text-align:left;padding:13px 8px;border-bottom:1px solid #dce5e8}.amount{text-align:right}footer{margin-top:36px;color:#666}@media print{body{margin:20px auto}}</style></head><body>
  <h1>Accordia payout statement</h1><p><strong>Payout ID:</strong> ${escapeHtml(payout.id)}<br><strong>Paystack reference:</strong> ${escapeHtml(payout.provider_reference)}<br><strong>Date:</strong> ${escapeHtml(date)}</p>
  <p><strong>Destination:</strong> ${escapeHtml(destination?.bank_name)} ending ${escapeHtml(destination?.account_last4)}<br><strong>Account name:</strong> ${escapeHtml(destination?.resolved_name)}</p>
  <table><thead><tr><th>Service</th><th>Type</th><th class="amount">Paid amount</th></tr></thead><tbody>${rows}</tbody></table>
  <h2>Total paid: ${escapeHtml(money(Number(payout.amount_kobo)))}</h2><footer>This is an Accordia payout statement, not a bank-issued receipt.</footer></body></html>`;
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
}
