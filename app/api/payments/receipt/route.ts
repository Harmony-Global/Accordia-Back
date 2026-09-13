import { fail, ok, parseSearchParams } from "@/lib/api";
import { requireUser } from "@/lib/auth";

const receiptSelect = "id, conversation_id, appointment_id, job_id, quote_id, payer_id, professional_id, payment_type, amount, currency, provider, provider_reference, provider_transaction_id, status, paid_at, receipt_number, receipt_issued_at, created_at, job:jobs(id, title), quote:job_quotes(id, project_title), appointment:appointments(id, starts_at, ends_at, service:professional_services(id, title)), payer:profiles!payments_payer_id_fkey(id, first_name, last_name, email), professional:profiles!payments_professional_id_fkey(id, first_name, last_name, email)";

function createReceiptNumber(paymentId: string, dateValue?: string | null) {
  const date = new Date(dateValue ?? Date.now()).toISOString().slice(0, 10).replace(/-/g, "");
  return `ACC-RCPT-${date}-${paymentId.slice(0, 8).toUpperCase()}`;
}

export async function GET(request: Request) {
  const auth = await requireUser(request);
  if (auth instanceof Response) return auth;

  const reference = parseSearchParams(request).get("reference");
  if (!reference) return fail("Payment reference is required", 422);

  const { data: payment, error } = await auth.adminClient
    .from("payments")
    .select(receiptSelect)
    .eq("provider", "paystack")
    .eq("provider_reference", reference)
    .single();

  if (error || !payment) return fail("Receipt not found", 404, error?.message);
  if (payment.payer_id !== auth.userId && payment.professional_id !== auth.userId && auth.role !== "admin") {
    return fail("Forbidden for this receipt", 403);
  }
  if (payment.status !== "success") return fail("Receipt is available after payment is successful", 409);

  if (!payment.receipt_number) {
    const { data: updatedPayment, error: updateError } = await auth.adminClient
      .from("payments")
      .update({
        receipt_issued_at: payment.receipt_issued_at ?? new Date().toISOString(),
        receipt_number: createReceiptNumber(payment.id, payment.paid_at ?? payment.created_at)
      })
      .eq("id", payment.id)
      .select(receiptSelect)
      .single();

    if (updateError || !updatedPayment) return fail("Receipt could not be issued", 400, updateError?.message);
    return ok({ receipt: updatedPayment });
  }

  return ok({ receipt: payment });
}
