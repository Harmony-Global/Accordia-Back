import { fail, ok } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { normalizeRelation } from "@/lib/conversations";
import { initializeAppointmentPayment, paymentFailure } from "@/lib/payments";
import { isPaystackConfigured } from "@/lib/paystack";

type Params = { params: { appointmentId: string } };

const appointmentSelect = "*, client:profiles!appointments_client_id_fkey(id, first_name, last_name, avatar_url, phone_verified), professional:profiles!appointments_professional_id_fkey(id, first_name, last_name, avatar_url, phone_verified, professional_profiles(*, professional_categories(category:categories(*)), professional_services(*, category:categories(*)))), service:professional_services(*), availability:professional_availability(*), reschedule_requests:appointment_reschedule_requests(*)";

type AppointmentPayload = {
  id: string;
  client_id: string;
  professional_id: string;
  service_id: string | null;
  status: string;
  payment_made_at?: string | null;
  payment_reference?: string | null;
  service?: { title?: string | null } | { title?: string | null }[] | null;
};

export async function POST(request: Request, { params }: Params) {
  const auth = await requireRole(request, ["client"]);
  if (auth instanceof Response) return auth;

  if (isPaystackConfigured()) {
    try {
      const payment = await initializeAppointmentPayment(auth, request, params.appointmentId);
      return ok({ payment }, { status: 202 });
    } catch (error) {
      return paymentFailure(error);
    }
  }

  const { data: appointment, error: appointmentError } = await auth.adminClient
    .from("appointments")
    .select("id, client_id, professional_id, service_id, status, payment_made_at, service:professional_services(title)")
    .eq("id", params.appointmentId)
    .single<AppointmentPayload>();

  if (appointmentError || !appointment) return fail("Appointment not found", 404, appointmentError?.message);
  if (appointment.client_id !== auth.userId) return fail("Only the client can pay for this appointment", 403);
  if (appointment.payment_made_at) return fail("This appointment has already been paid", 409);
  if (appointment.status !== "accepted") return fail("The appointment must be accepted before hiring and payment can continue", 409);

  const { error: updateError } = await auth.adminClient
    .from("appointments")
    .update({
      hired_at: new Date().toISOString(),
      hired_by: auth.userId,
      payment_made_at: new Date().toISOString(),
      payment_made_by: auth.userId,
      payment_reference: null
    })
    .eq("id", appointment.id);

  if (updateError) return fail("Could not record appointment payment", 400, updateError.message);

  const service = normalizeRelation(appointment.service);
  await auth.adminClient.from("notifications").insert({
    user_id: appointment.professional_id,
    type: "appointment_payment_made",
    title: "Appointment payment made",
    body: `The client paid for the appointment${service?.title ? ` for "${service.title}"` : ""}.`,
    data: {
      appointment_id: appointment.id,
      service_id: appointment.service_id
    },
    channel: "in_app"
  });

  await auth.adminClient.from("notifications").insert({
    user_id: appointment.client_id,
    type: "appointment_payment_confirmed",
    title: "Appointment payment confirmed",
    body: `Your appointment payment${service?.title ? ` for "${service.title}"` : ""} was successful. Your receipt is ready.`,
    data: {
      appointment_id: appointment.id,
      service_id: appointment.service_id
    },
    channel: "in_app"
  });

  const { data: updatedAppointment, error: refreshError } = await auth.adminClient
    .from("appointments")
    .select(appointmentSelect)
    .eq("id", appointment.id)
    .single();

  if (refreshError || !updatedAppointment) return fail("Payment recorded, but appointment could not be refreshed", 400, refreshError?.message);

  return ok({ appointment: updatedAppointment });
}
