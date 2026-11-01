import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { listPaystackRefunds, type PaystackRefund } from "@/lib/paystack";

type AdminClient = ReturnType<typeof createSupabaseAdmin>;
const refundStatuses = new Set(["pending", "processing", "needs-attention", "failed", "processed"]);

export async function recordPaystackRefund(adminClient: AdminClient, refund: PaystackRefund) {
  const transactionId = typeof refund.transaction === "object" ? refund.transaction.id : refund.transaction;
  if (!Number.isSafeInteger(Number(refund.id)) || !Number.isSafeInteger(Number(transactionId)) ||
      !Number.isSafeInteger(Number(refund.amount)) || refund.amount <= 0 ||
      refund.currency !== "NGN" || !refundStatuses.has(refund.status)) {
    throw new Error("Invalid Paystack refund record");
  }
  const { data: payment, error: paymentError } = await adminClient.from("payments")
    .select("id,professional_id,conversation_id,appointment_id")
    .eq("provider", "paystack").eq("provider_transaction_id", String(transactionId)).maybeSingle();
  if (paymentError) throw new Error(paymentError.message);
  if (!payment) return false;

  const providerId = String(refund.id);
  const { data: existing, error: existingError } = await adminClient.from("payment_refunds")
    .select("id,status,payment_id,initiated_at,processed_at,reconciled_at")
    .eq("provider_refund_id", providerId).maybeSingle();
  if (existingError) throw new Error(existingError.message);
  if (existing?.payment_id && existing.payment_id !== payment.id) throw new Error("Refund transaction changed");
  if (existing && ["failed", "processed"].includes(existing.status) && existing.status !== refund.status) return true;

  const initiatedAt = existing?.initiated_at ?? refund.created_at ?? refund.createdAt;
  if (!initiatedAt || Number.isNaN(Date.parse(initiatedAt))) throw new Error("Refund initiation date is missing");
  const processedAt = refund.status === "processed"
    ? existing?.processed_at ?? refund.refunded_at ?? refund.updated_at ?? refund.updatedAt ?? new Date().toISOString()
    : null;
  const refundData = {
    payment_id: payment.id, provider_refund_id: providerId, amount_kobo: refund.amount,
    currency: refund.currency, status: refund.status, initiated_at: initiatedAt,
    processed_at: processedAt, updated_at: new Date().toISOString()
  };
  const { error: saveError } = await adminClient.from("payment_refunds")
    .upsert(refundData, { onConflict: "provider_refund_id" });
  if (saveError) throw new Error(saveError.message);

  const sourceType = payment.conversation_id ? "job" : payment.appointment_id ? "appointment" : null;
  const sourceId = payment.conversation_id ?? payment.appointment_id;
  if (!sourceType || !sourceId) return true;
  const { data: earning, error: earningError } = await adminClient.from("professional_earnings")
    .select("id,professional_id,hold_reason")
    .eq("source_type", sourceType).eq("source_id", sourceId).maybeSingle();
  if (earningError) throw new Error(earningError.message);
  if (!earning) return true;
  if (refund.status !== "failed" && !existing?.reconciled_at) {
    if (!earning.hold_reason) {
      const held = await adminClient.from("professional_earnings")
        .update({ hold_reason: "Refund requires admin reconciliation" })
        .eq("id", earning.id).is("hold_reason", null);
      if (held.error) throw new Error(held.error.message);
    }
    const exception = await adminClient.from("payout_exceptions").upsert({
      professional_id: earning.professional_id,
      source_type: sourceType,
      source_id: sourceId,
      reason: "Paystack refund requires manual payout reconciliation"
    }, { onConflict: "source_type,source_id,reason", ignoreDuplicates: true });
    if (exception.error) throw new Error(exception.error.message);
    const { data: allocation, error: allocationError } = await adminClient.from("payout_allocations")
      .select("payout:professional_payouts!inner(status)").eq("earning_id", earning.id);
    if (allocationError) throw new Error(allocationError.message);
    if ((allocation ?? []).some((item) => {
      const payout = Array.isArray(item.payout) ? item.payout[0] : item.payout;
      return payout?.status === "success";
    })) {
      const paidException = await adminClient.from("payout_exceptions").upsert({
        professional_id: earning.professional_id, source_type: sourceType, source_id: sourceId,
        reason: "Refund affects an already-disbursed earning; manual recovery required"
      }, { onConflict: "source_type,source_id,reason", ignoreDuplicates: true });
      if (paidException.error) throw new Error(paidException.error.message);
    }
  } else if (refund.status === "failed") {
    const { data: sourcePayments, error: sourceError } = await adminClient.from("payments")
      .select("id").eq(sourceType === "job" ? "conversation_id" : "appointment_id", sourceId);
    if (sourceError) throw new Error(sourceError.message);
    const { data: active, error: activeError } = await adminClient.from("payment_refunds")
      .select("id").in("payment_id", (sourcePayments ?? []).map((item) => item.id))
      .neq("status", "failed").is("reconciled_at", null).limit(1);
    if (activeError) throw new Error(activeError.message);
    const activeForSource = Boolean(active?.length);
    if (!activeForSource) {
      const released = await adminClient.from("professional_earnings").update({ hold_reason: null })
        .eq("id", earning.id).eq("hold_reason", "Refund requires admin reconciliation");
      if (released.error) throw new Error(released.error.message);
      const resolved = await adminClient.from("payout_exceptions")
        .update({ resolved_at: new Date().toISOString() })
        .eq("source_type", sourceType).eq("source_id", sourceId)
        .in("reason", ["Paystack refund requires manual payout reconciliation", "Refund affects an already-disbursed earning; manual recovery required"])
        .is("resolved_at", null);
      if (resolved.error) throw new Error(resolved.error.message);
    }
  }
  return true;
}

export async function syncPaystackRefundPage(adminClient: AdminClient, page: number, transactionId?: string) {
  const refunds = await listPaystackRefunds(page, transactionId);
  let recorded = 0;
  for (const refund of refunds) {
    if (await recordPaystackRefund(adminClient, refund)) recorded += 1;
  }
  return { fetched: refunds.length, recorded, has_more: refunds.length === 50, next_page: page + 1 };
}
