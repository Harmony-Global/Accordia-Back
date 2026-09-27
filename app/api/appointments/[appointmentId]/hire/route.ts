import { fail, ok } from "@/lib/api";
import { requireRole } from "@/lib/auth";

type Params = { params: { appointmentId: string } };

export async function POST(request: Request, { params }: Params) {
  const auth = await requireRole(request, ["client"]);
  if (auth instanceof Response) return auth;

  const { data: appointment, error } = await auth.adminClient
    .from("appointments")
    .select("id, client_id, professional_id, service_id, status, hired_at, price_amount")
    .eq("id", params.appointmentId)
    .single();
  if (error || !appointment) return fail("Appointment not found", 404, error?.message);
  if (appointment.client_id !== auth.userId) return fail("Only the client can hire for this appointment", 403);
  if (appointment.status !== "accepted") return fail("Only accepted appointments can be hired", 409);
  if (!appointment.price_amount) return fail("This appointment needs support to confirm its original price before hiring", 409);

  if (Number(appointment.price_amount) <= 0) return fail("This appointment needs an agreed price before hiring", 409);

  if (!appointment.hired_at) {
    const { data: hired, error: updateError } = await auth.adminClient
      .from("appointments")
      .update({ hired_at: new Date().toISOString(), hired_by: auth.userId })
      .eq("id", appointment.id)
      .eq("status", "accepted")
      .is("hired_at", null)
      .select("id")
      .maybeSingle();
    if (updateError) return fail("Could not confirm hire", 400, updateError.message);
    if (hired) {
      await auth.adminClient.from("notifications").insert({
        user_id: appointment.professional_id,
        type: "appointment_hired",
        title: "You were hired for an appointment",
        body: "The client confirmed your hire. Payment is pending.",
        data: { appointment_id: appointment.id },
        channel: "in_app"
      });
    }
  }

  const { data: current, error: refreshError } = await auth.adminClient
    .from("appointments")
    .select("*, service:professional_services(*), reschedule_requests:appointment_reschedule_requests(*)")
    .eq("id", appointment.id)
    .single();
  if (refreshError || !current) return fail("Hire confirmed, but appointment could not be refreshed", 400, refreshError?.message);
  if (current.status !== "accepted" || !current.hired_at) return fail("This appointment is no longer available to hire", 409);
  return ok({ appointment: current });
}
