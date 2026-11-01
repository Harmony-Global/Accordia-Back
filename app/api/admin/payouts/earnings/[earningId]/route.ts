import { z } from "zod";
import { fail, ok } from "@/lib/api";
import { requireRole } from "@/lib/auth";

type Params = { params: { earningId: string } };
const patchSchema = z.object({ hold_reason: z.string().trim().min(5).max(500).nullable() });

export async function PATCH(request: Request, { params }: Params) {
  const auth = await requireRole(request, ["admin"]);
  if (auth instanceof Response) return auth;
  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return fail("Invalid hold reason", 422, parsed.error.flatten());
  if (parsed.data.hold_reason === null) {
    const { data: earning, error: earningError } = await auth.adminClient.from("professional_earnings")
      .select("source_type,source_id").eq("id", params.earningId).maybeSingle();
    if (earningError || !earning) return fail("Earning not found", 404, earningError?.message);
    const { data: payments, error: paymentError } = await auth.adminClient.from("payments")
      .select("id").eq(earning.source_type === "job" ? "conversation_id" : "appointment_id", earning.source_id);
    if (paymentError) return fail("Could not inspect related payments", 400, paymentError.message);
    if (payments?.length) {
      const { data: refunds, error: refundError } = await auth.adminClient.from("payment_refunds")
        .select("id").in("payment_id", payments.map((payment) => payment.id))
        .neq("status", "failed").is("reconciled_at", null).limit(1);
      if (refundError) return fail("Could not inspect refund holds", 400, refundError.message);
      if (refunds?.length) return fail("Reconcile the refund before releasing this earning", 409);
    }
  }
  const { data, error } = await auth.adminClient.from("professional_earnings")
    .update({ hold_reason: parsed.data.hold_reason }).eq("id", params.earningId)
    .select("id,hold_reason").maybeSingle();
  if (error || !data) return fail("Earning not found or could not be updated", 404, error?.message);
  return ok({ earning: data });
}
