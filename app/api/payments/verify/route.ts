import { fail, ok, parseSearchParams } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { applyPaystackPaymentData, paymentFailure } from "@/lib/payments";
import { verifyPaystackTransaction } from "@/lib/paystack";

export async function GET(request: Request) {
  const auth = await requireUser(request);
  if (auth instanceof Response) return auth;

  const reference = parseSearchParams(request).get("reference");
  if (!reference) return fail("Payment reference is required", 422);

  const { data: payment, error: paymentError } = await auth.adminClient
    .from("payments")
    .select("id, payer_id, professional_id, provider_reference")
    .eq("provider", "paystack")
    .eq("provider_reference", reference)
    .single();

  if (paymentError || !payment) return fail("Payment record not found", 404, paymentError?.message);
  if (payment.payer_id !== auth.userId && payment.professional_id !== auth.userId && auth.role !== "admin") {
    return fail("Forbidden for this payment", 403);
  }

  try {
    const transaction = await verifyPaystackTransaction(reference);
    const result = await applyPaystackPaymentData(auth.adminClient, reference, transaction, "verify");
    return ok(result);
  } catch (error) {
    return paymentFailure(error);
  }
}
