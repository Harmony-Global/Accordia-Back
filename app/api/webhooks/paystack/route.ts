import { fail, ok } from "@/lib/api";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { applyPaystackPaymentData, paymentFailure } from "@/lib/payments";
import { isPaystackConfigured, verifyPaystackWebhookSignature, type PaystackTransactionData } from "@/lib/paystack";

type PaystackWebhookEvent = {
  event?: string;
  data?: PaystackTransactionData;
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
