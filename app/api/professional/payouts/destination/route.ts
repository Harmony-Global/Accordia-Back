import { z } from "zod";
import { fail, ok } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { createPaystackRecipient, listPaystackBanks, PaystackError, resolvePaystackAccount } from "@/lib/paystack";

const destinationSchema = z.object({
  holder_name: z.string().trim().min(2).max(120),
  notification_email: z.string().trim().email().max(254),
  bank_code: z.string().trim().min(1).max(20),
  account_number: z.union([z.string().regex(/^\d{10}$/), z.literal("")])
});

export async function GET(request: Request) {
  const auth = await requireRole(request, ["professional"]);
  if (auth instanceof Response) return auth;
  const { data, error } = await auth.adminClient.from("payout_destinations")
    .select("id,bank_code,bank_name,account_last4,resolved_name,holder_name,notification_email,status,updated_at")
    .eq("professional_id", auth.userId).eq("is_current", true).maybeSingle();
  if (error) return fail("Could not load payout destination", 400, error.message);
  return ok({ destination: data });
}

export async function PUT(request: Request) {
  const auth = await requireRole(request, ["professional"]);
  if (auth instanceof Response) return auth;
  const parsed = destinationSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return fail("Invalid payout details", 422, parsed.error.flatten());
  const input = parsed.data;
  if (!input.account_number) {
    const { data: current, error: currentError } = await auth.adminClient.from("payout_destinations")
      .select("id,bank_code,bank_name,account_last4,resolved_name,recipient_code")
      .eq("professional_id", auth.userId).eq("is_current", true).maybeSingle();
    if (currentError || !current || current.bank_code !== input.bank_code) return fail("Enter the account number for a new bank", 422);
    const normalized = (value: string) => value.toLowerCase().replace(/[^a-z ]/g, "").replace(/\s+/g, " ").trim();
    const needsReview = normalized(current.resolved_name) !== normalized(input.holder_name);
    const { data: id, error } = await auth.adminClient.rpc("replace_payout_destination", {
      p_professional_id: auth.userId, p_bank_code: current.bank_code, p_bank_name: current.bank_name,
      p_last4: current.account_last4, p_resolved_name: current.resolved_name, p_holder_name: input.holder_name,
      p_email: input.notification_email, p_recipient_code: current.recipient_code,
      p_status: needsReview ? "pending_review" : "verified"
    });
    if (error) return fail("Could not save payout details", 400, error.message);
    return ok({ destination_id: id, review_required: needsReview });
  }
  try {
    const [banks, resolved] = await Promise.all([
      listPaystackBanks(), resolvePaystackAccount(input.bank_code, input.account_number)
    ]);
    const bank = banks.find((item) => item.code === input.bank_code && item.active !== false);
    if (!bank || resolved.account_number !== input.account_number) return fail("Bank account could not be verified", 422);
    const recipient = await createPaystackRecipient({
      name: resolved.account_name,
      bank_code: input.bank_code,
      account_number: input.account_number
    });
    if (!recipient.recipient_code) return fail("Payout recipient could not be created", 502);
    const normalized = (value: string) => value.toLowerCase().replace(/[^a-z ]/g, "").replace(/\s+/g, " ").trim();
    const needsReview = normalized(resolved.account_name) !== normalized(input.holder_name);
    const { data: id, error } = await auth.adminClient.rpc("replace_payout_destination", {
      p_professional_id: auth.userId,
      p_bank_code: bank.code,
      p_bank_name: bank.name,
      p_last4: input.account_number.slice(-4),
      p_resolved_name: resolved.account_name,
      p_holder_name: input.holder_name,
      p_email: input.notification_email,
      p_recipient_code: recipient.recipient_code,
      p_status: needsReview ? "pending_review" : "verified"
    });
    if (error) return fail("Could not save payout details", 400, error.message);
    return ok({ destination_id: id, review_required: needsReview });
  } catch (error) {
    return fail(error instanceof PaystackError ? error.message : "Could not verify payout details", error instanceof PaystackError ? error.status : 502);
  }
}
