import { z } from "zod";
import { fail, ok, parseSearchParams } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { notifyPayoutConfirmed } from "@/lib/payout-notifications";
import { lastFridayCutoff } from "@/lib/payouts";
import { fetchPaystackRecipient, PaystackError, verifyPaystackTransfer, type PaystackRecipient } from "@/lib/paystack";

const reconcileSchema = z.object({
  destination_id: z.string().uuid(),
  reference: z.string().trim().min(8).max(120),
  allocations: z.array(z.object({ id: z.string().uuid(), amount_kobo: z.number().int().positive() })).min(1).max(100)
});

export async function GET(request: Request) {
  const auth = await requireRole(request, ["admin"]);
  if (auth instanceof Response) return auth;
  const view = parseSearchParams(request).get("view") ?? "queue";
  if (view === "queue") {
    const page = Number(parseSearchParams(request).get("page") ?? "1");
    if (!Number.isInteger(page) || page < 1) return fail("Invalid page", 422);
    const cutoff = lastFridayCutoff();
    const { data, error } = await auth.adminClient.rpc("admin_payout_queue", {
      p_cutoff: cutoff, p_limit: 51, p_offset: (page - 1) * 50
    });
    if (error) return fail("Could not load payout queue", 400, error.message);
    return ok({ earnings: (data ?? []).slice(0, 50), has_more: (data ?? []).length > 50, page, cutoff_at: cutoff });
  }
  if (view === "destinations") {
    const { data, error } = await auth.adminClient.from("payout_destinations")
      .select("id,professional_id,bank_name,account_last4,resolved_name,holder_name,notification_email,status,updated_at,professional:profiles!payout_destinations_professional_id_fkey(first_name,last_name)")
      .eq("is_current", true).eq("status", "pending_review").order("updated_at", { ascending: true }).limit(100);
    if (error) return fail("Could not load payout destinations", 400, error.message);
    return ok({ destinations: data ?? [] });
  }
  if (view === "exceptions") {
    const { data, error } = await auth.adminClient.from("payout_exceptions")
      .select("*").is("resolved_at", null).order("created_at", { ascending: false }).limit(100);
    if (error) return fail("Could not load payout exceptions", 400, error.message);
    return ok({ exceptions: data ?? [] });
  }
  if (view === "history") {
    const { data, error } = await auth.adminClient.from("professional_payouts")
      .select("id,professional_id,provider_reference,amount_kobo,status,display_at,destination:payout_destinations(bank_name,account_last4)")
      .order("display_at", { ascending: false }).limit(100);
    if (error) return fail("Could not load reconciled payouts", 400, error.message);
    return ok({ payouts: data ?? [] });
  }
  return fail("Unknown admin payout view", 422);
}

export async function POST(request: Request) {
  const auth = await requireRole(request, ["admin"]);
  if (auth instanceof Response) return auth;
  const parsed = reconcileSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return fail("Invalid payout reconciliation", 422, parsed.error.flatten());
  const { destination_id, reference, allocations } = parsed.data;
  const { data: destination, error: destinationError } = await auth.adminClient.from("payout_destinations")
    .select("id,professional_id,recipient_code,bank_code,account_last4,status")
    .eq("id", destination_id).maybeSingle();
  if (destinationError || !destination) return fail("Payout destination not found", 404);
  if (destination.status !== "verified") return fail("Payout destination requires review", 409);
  try {
    const transfer = await verifyPaystackTransfer(reference);
    if (transfer.reference !== reference || transfer.currency !== "NGN" || !Number.isInteger(transfer.amount) || transfer.amount <= 0) {
      return fail("Paystack transfer details do not match", 409);
    }
    if (!["pending", "success", "failed", "reversed"].includes(transfer.status)) {
      return fail("Transfer has not reached a reconcilable state", 409);
    }
    const transferRecipientValue = transfer.recipient;
    const transferRecipient: PaystackRecipient = typeof transferRecipientValue === "object" && transferRecipientValue !== null
      ? transferRecipientValue
      : await fetchPaystackRecipient(String(transferRecipientValue ?? ""));
    const [savedRecipient, actualRecipient] = await Promise.all([
      fetchPaystackRecipient(destination.recipient_code),
      transferRecipient.details?.account_number ? Promise.resolve(transferRecipient) : fetchPaystackRecipient(transferRecipient.recipient_code)
    ]);
    if (!savedRecipient.details?.account_number ||
      actualRecipient.details?.account_number !== savedRecipient.details.account_number ||
      actualRecipient.details?.bank_code !== destination.bank_code ||
      !actualRecipient.details.account_number.endsWith(destination.account_last4)) {
      return fail("Transfer recipient differs from this professional's verified bank", 409);
    }
    const { data: previous } = await auth.adminClient.from("professional_payouts")
      .select("id,status").eq("provider_reference", reference).maybeSingle();
    const { data: payoutId, error } = await auth.adminClient.rpc("record_verified_professional_payout", {
      p_destination_id: destination_id,
      p_reference: reference,
      p_transfer_code: transfer.transfer_code ?? null,
      p_amount_kobo: transfer.amount,
      p_status: transfer.status,
      p_transferred_at: transfer.transferred_at ?? transfer.updatedAt ?? null,
      p_reconciled_by: auth.userId,
      p_allocations: allocations
    });
    if (error) return fail("Could not reconcile transfer", 409, error.message);
    if (transfer.status === "success" && previous?.status !== "success") {
      await notifyPayoutConfirmed(auth.adminClient, payoutId);
    }
    return ok({ payout_id: payoutId, status: transfer.status });
  } catch (error) {
    return fail(error instanceof PaystackError ? error.message : "Could not verify transfer", error instanceof PaystackError ? error.status : 502);
  }
}
