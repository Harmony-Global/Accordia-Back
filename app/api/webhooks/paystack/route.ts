import { fail, ok } from "@/lib/api";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { applyPaystackPaymentData, paymentFailure } from "@/lib/payments";
import { isPaystackConfigured, verifyPaystackWebhookSignature, type PaystackTransactionData } from "@/lib/paystack";
import { notifyPayoutConfirmed } from "@/lib/payout-notifications";

type PaystackWebhookEvent = {
  event?: string;
  data?: PaystackTransactionData & { currency?: string; transfer_code?: string; transferred_at?: string | null; updatedAt?: string | null };
};

export async function POST(request: Request) {
  const rawBody = await request.text();
  const signature = request.headers.get("x-paystack-signature");

  if (!isPaystackConfigured()) {
    return fail("Paystack is not configured", 503);
  }

  if (!verifyPaystackWebhookSignature(rawBody, signature)) {
    return fail("Invalid Paystack signature", 401);
  }

  let event: PaystackWebhookEvent;
  try {
    event = JSON.parse(rawBody) as PaystackWebhookEvent;
  } catch {
    return fail("Invalid webhook payload", 422);
  }

  if (["transfer.success", "transfer.failed", "transfer.reversed"].includes(event.event ?? "")) {
    const status = event.event?.split(".")[1];
    const reference = event.data?.reference;
    if (!reference || !status) return fail("Transfer reference is required", 422);
    const adminClient = createSupabaseAdmin();
    const { data: payout, error } = await adminClient.from("professional_payouts")
      .select("id,status,amount_kobo,currency").eq("provider_reference", reference).maybeSingle();
    if (error) return fail("Could not inspect transfer", 400, error.message);
    if (!payout) return ok({ received: true, reconciliation_pending: true });
    if (event.data?.amount !== Number(payout.amount_kobo) || event.data.currency !== payout.currency) {
      return fail("Transfer amount or currency mismatch", 409);
    }
    if (payout.status === "reversed" && status !== "reversed") return ok({ received: true });
    if (payout.status === "success" && status === "failed") return ok({ received: true });
    if (payout.status === "failed" && status !== "failed") return ok({ received: true, reconciliation_pending: true });
    if (payout.status !== status) {
      const update = await adminClient.from("professional_payouts").update({
        status,
        transfer_code: event.data?.transfer_code ?? null,
        transferred_at: status === "success" ? event.data?.transferred_at ?? event.data?.updatedAt ?? new Date().toISOString() : null,
        updated_at: new Date().toISOString()
      }).eq("id", payout.id);
      if (update.error) return fail("Could not reconcile transfer status", 400, update.error.message);
      if (status === "success") await notifyPayoutConfirmed(adminClient, payout.id);
    }
    return ok({ received: true });
  }

  if (event.event !== "charge.success") {
    return ok({ received: true });
  }

  const reference = event.data?.reference;
  if (!reference) return fail("Payment reference is required", 422);

  try {
    await applyPaystackPaymentData(createSupabaseAdmin(), reference, event.data ?? {}, "webhook");
    return ok({ received: true });
  } catch (error) {
    return paymentFailure(error);
  }
}
