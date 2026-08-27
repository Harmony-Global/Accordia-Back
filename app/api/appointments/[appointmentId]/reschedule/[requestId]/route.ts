import { fail, ok } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { appointmentRescheduleResponseSchema } from "@/lib/validators";

type Params = { params: { appointmentId: string; requestId: string } };

const appointmentSelect = "*, client:profiles!appointments_client_id_fkey(id, first_name, last_name, avatar_url, phone_verified), professional:profiles!appointments_professional_id_fkey(id, first_name, last_name, avatar_url, phone_verified, professional_profiles(*, professional_categories(category:categories(*)), professional_services(*, category:categories(*)))), service:professional_services(*), availability:professional_availability(*), reschedule_requests:appointment_reschedule_requests(*)";

function canUseAppointment(
  appointment: { client_id: string; professional_id: string },
  auth: { role: string; userId: string }
) {
  return auth.role === "admin"
    || appointment.client_id === auth.userId
    || appointment.professional_id === auth.userId;
}

export async function PATCH(request: Request, { params }: Params) {
  const auth = await requireUser(request);
  if (auth instanceof Response) return auth;

  const body = appointmentRescheduleResponseSchema.safeParse(await request.json());
  if (!body.success) return fail("Invalid reschedule response", 422, body.error.flatten());

  const { data: appointment, error: appointmentError } = await auth.adminClient
    .from("appointments")
    .select("id, client_id, professional_id, inquiry_id, starts_at, ends_at, status")
    .eq("id", params.appointmentId)
    .single();

  if (appointmentError || !appointment) return fail("Appointment not found", 404, appointmentError?.message);
  if (!canUseAppointment(appointment, auth)) return fail("Forbidden for this appointment", 403);
  if (appointment.status !== "accepted") return fail("Only accepted appointments can be rescheduled", 409);

  const { data: rescheduleRequest, error: rescheduleError } = await auth.adminClient
    .from("appointment_reschedule_requests")
    .select("*")
    .eq("id", params.requestId)
    .eq("appointment_id", appointment.id)
    .single();

  if (rescheduleError || !rescheduleRequest) return fail("Reschedule request not found", 404, rescheduleError?.message);
  if (rescheduleRequest.status !== "pending") return fail("This reschedule request has already been answered", 409);
  if (auth.role !== "admin" && rescheduleRequest.requested_for !== auth.userId) {
    return fail("Only the receiving party can respond to this reschedule", 403);
  }

  const nextStatus = body.data.status;
  const { data: updatedRequest, error: updateRequestError } = await auth.adminClient
    .from("appointment_reschedule_requests")
    .update({
      status: nextStatus,
      responded_by: auth.userId,
      responded_at: new Date().toISOString()
    })
    .eq("id", rescheduleRequest.id)
    .select("*")
    .single();

  if (updateRequestError || !updatedRequest) return fail("Could not update reschedule request", 400, updateRequestError?.message);

  if (nextStatus === "accepted") {
    const { error: appointmentUpdateError } = await auth.adminClient
      .from("appointments")
      .update({
        starts_at: rescheduleRequest.proposed_starts_at,
        ends_at: rescheduleRequest.proposed_ends_at
      })
      .eq("id", appointment.id);

    if (appointmentUpdateError) return fail("Could not update appointment schedule", 400, appointmentUpdateError.message);
  }

  const receiverId = rescheduleRequest.requested_by;
  const startsAt = new Date(rescheduleRequest.proposed_starts_at);
  const endsAt = new Date(rescheduleRequest.proposed_ends_at);
  const decisionText = nextStatus === "accepted" ? "accepted" : "declined";
  const messageBody = `Reschedule ${decisionText}: ${startsAt.toLocaleString()} - ${endsAt.toLocaleString()}.`;

  let message = null;
  if (appointment.inquiry_id) {
    const { data: messageData, error: messageError } = await auth.adminClient
      .from("messages")
      .insert({
        inquiry_id: appointment.inquiry_id,
        sender_id: auth.userId,
        receiver_id: receiverId,
        body: messageBody
      })
      .select("*, sender:profiles!messages_sender_id_fkey(id, first_name, last_name, avatar_url), receiver:profiles!messages_receiver_id_fkey(id, first_name, last_name, avatar_url)")
      .single();

    if (messageError) return fail("Reschedule updated, but chat notice could not be sent", 400, messageError.message);
    message = messageData;
  }

  await auth.adminClient.from("appointment_audit_logs").insert({
    appointment_id: appointment.id,
    availability_id: null,
    client_id: appointment.client_id,
    professional_id: appointment.professional_id,
    actor_id: auth.userId,
    action: `reschedule_${decisionText}`,
    previous_status: appointment.status,
    next_status: appointment.status,
    metadata: {
      reschedule_request_id: rescheduleRequest.id,
      previous_starts_at: appointment.starts_at,
      previous_ends_at: appointment.ends_at,
      proposed_starts_at: rescheduleRequest.proposed_starts_at,
      proposed_ends_at: rescheduleRequest.proposed_ends_at,
      inquiry_id: appointment.inquiry_id
    }
  });

  await auth.adminClient.from("notifications").insert({
    user_id: receiverId,
    type: `appointment_reschedule_${decisionText}`,
    title: nextStatus === "accepted" ? "Appointment reschedule accepted" : "Appointment reschedule declined",
    body: nextStatus === "accepted"
      ? "The proposed appointment time has been accepted."
      : "The proposed appointment time was declined.",
    data: {
      appointment_id: appointment.id,
      inquiry_id: appointment.inquiry_id,
      reschedule_request_id: rescheduleRequest.id
    },
    channel: "in_app"
  });

  const { data: updatedAppointment, error: updatedError } = await auth.adminClient
    .from("appointments")
    .select(appointmentSelect)
    .eq("id", appointment.id)
    .single();

  if (updatedError || !updatedAppointment) return fail("Could not load appointment", 400, updatedError?.message);

  return ok({ appointment: updatedAppointment, reschedule_request: updatedRequest, message });
}
