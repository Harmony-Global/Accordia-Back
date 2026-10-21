import { env } from "@/lib/env";
import type { createSupabaseAdmin } from "@/lib/supabase/admin";

type AdminClient = ReturnType<typeof createSupabaseAdmin>;

export async function notifyPayoutConfirmed(adminClient: AdminClient, payoutId: string) {
  const { data: payout } = await adminClient.from("professional_payouts")
    .select("id,professional_id,amount_kobo,provider_reference,destination:payout_destinations(notification_email)")
    .eq("id", payoutId).eq("status", "success").maybeSingle();
  if (!payout) return;
  const amount = new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN" }).format(Number(payout.amount_kobo) / 100);
  await adminClient.from("notifications").insert({
    user_id: payout.professional_id,
    type: "payout_confirmed",
    title: "Payout confirmed",
    body: `${amount} was sent to your payout account. View your payout statement in Payment History.`,
    data: { payout_id: payout.id }, channel: "in_app"
  });
  const destination = Array.isArray(payout.destination) ? payout.destination[0] : payout.destination;
  if (!env.resendApiKey || !env.resendFromEmail || !destination?.notification_email) return;
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${env.resendApiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: env.resendFromEmail,
        to: destination.notification_email,
        subject: "Your Accordia payout is confirmed",
        text: `${amount} was sent to your payout account. Reference: ${payout.provider_reference}. View your payout statement in Accordia.`
      })
    });
    if (!response.ok) console.warn("Payout email failed", response.status);
  } catch (error) {
    console.warn("Payout email failed", error);
  }
}
