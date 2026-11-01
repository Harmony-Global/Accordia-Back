import { z } from "zod";
import { fail, ok } from "@/lib/api";
import { requireRole } from "@/lib/auth";

type Params = { params: { refundId: string } };
const schema = z.object({ note: z.string().trim().min(10).max(1000) }).strict();

export async function POST(request: Request, { params }: Params) {
  const auth = await requireRole(request, ["admin"]);
  if (auth instanceof Response) return auth;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return fail("Explain how this refund was reconciled", 422, parsed.error.flatten());
  const { data: refund, error } = await auth.adminClient.from("payment_refunds")
    .select("id,status,reconciled_at,payment:payments(conversation_id,appointment_id)")
    .eq("id", params.refundId).maybeSingle();
  if (error || !refund) return fail("Refund not found", 404, error?.message);
  if (!["processed", "failed"].includes(refund.status)) return fail("Refund must reach a final status first", 409);
  if (!refund.reconciled_at) {
    const { error: updateError } = await auth.adminClient.from("payment_refunds").update({
      reconciled_at: new Date().toISOString(), reconciled_by: auth.userId,
      reconciliation_note: parsed.data.note
    }).eq("id", refund.id).is("reconciled_at", null);
    if (updateError) return fail("Could not reconcile refund", 400, updateError.message);
  }
  const payment = Array.isArray(refund.payment) ? refund.payment[0] : refund.payment;
  const sourceType = payment?.conversation_id ? "job" : "appointment";
  const sourceId = payment?.conversation_id ?? payment?.appointment_id;
  if (sourceId) {
    const { data: sourcePayments, error: sourceError } = await auth.adminClient.from("payments")
      .select("id").eq(sourceType === "job" ? "conversation_id" : "appointment_id", sourceId);
    if (sourceError) return fail("Refund recorded, but source payments could not be checked", 400, sourceError.message);
    if (sourcePayments?.length) {
      const { data: remaining, error: remainingError } = await auth.adminClient.from("payment_refunds")
        .select("id").in("payment_id", sourcePayments.map((sourcePayment) => sourcePayment.id))
        .neq("status", "failed").is("reconciled_at", null).limit(1);
      if (remainingError) return fail("Refund recorded, but related refunds could not be checked", 400, remainingError.message);
      if (!remaining?.length) {
        const { error: exceptionError } = await auth.adminClient.from("payout_exceptions")
          .update({ resolved_at: new Date().toISOString(), resolved_by: auth.userId })
          .eq("source_type", sourceType).eq("source_id", sourceId)
          .eq("reason", "Paystack refund requires manual payout reconciliation").is("resolved_at", null);
        if (exceptionError) return fail("Refund recorded, but exception could not be closed", 400, exceptionError.message);
      }
    }
  }
  return ok({ reconciled: true, hold_released: false });
}
