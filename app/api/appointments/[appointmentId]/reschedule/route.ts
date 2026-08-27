import { created, fail } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { appointmentRescheduleCreateSchema } from "@/lib/validators";

type Params = { params: { appointmentId: string } };
type AuthContext = Exclude<Awaited<ReturnType<typeof requireUser>>, Response>;

const appointmentSelect = "*, client:profiles!appointments_client_id_fkey(id, first_name, last_name, avatar_url, phone_verified), professional:profiles!appointments_professional_id_fkey(id, first_name, last_name, avatar_url, phone_verified, professional_profiles(*, professional_categories(category:categories(*)), professional_services(*, category:categories(*)))), service:professional_services(*), availability:professional_availability(*), reschedule_requests:appointment_reschedule_requests(*)";

function canUseAppointment(
  appointment: { client_id: string; professional_id: string },
  auth: { role: string; userId: string }
) {
  return auth.role === "admin"
    || appointment.client_id === auth.userId
    || appointment.professional_id === auth.userId;
}

async function ensureInquiry(
  auth: AuthContext,
  appointment: { id: string; client_id: string; professional_id: string; service_id: string | null; inquiry_id: string | null }
) {
  if (appointment.inquiry_id) return appointment.inquiry_id;

  let existingInquiryQuery = auth.adminClient
    .from("professional_inquiries")
    .select("id")
    .eq("client_id", appointment.client_id)
    .eq("professional_id", appointment.professional_id);

  existingInquiryQuery = appointment.service_id
    ? existingInquiryQuery.eq("service_id", appointment.service_id)
    : existingInquiryQuery.is("service_id", null);

  const { data: existingInquiry, error: existingInquiryError } = await existingInquiryQuery.maybeSingle();
  if (existingInquiryError) throw new Error(existingInquiryError.message);

  if (existingInquiry) {
    const { error: reopenError } = await auth.adminClient
      .from("professional_inquiries")
      .update({ status: "open" })
      .eq("id", existingInquiry.id);
    if (reopenError) throw new Error(reopenError.message);

    const { error: appointmentUpdateError } = await auth.adminClient
      .from("appointments")
      .update({ inquiry_id: existingInquiry.id })
      .eq("id", appointment.id);
    if (appointmentUpdateError) throw new Error(appointmentUpdateError.message);

    return existingInquiry.id as string;
  }

  const { data: inquiry, error: createError } = await auth.adminClient
    .from("professional_inquiries")
    .insert({
      client_id: appointment.client_id,
      professional_id: appointment.professional_id,
      service_id: appointment.service_id,
      status: "open"
    })
    .select("id")
    .single();

  if (createError || !inquiry) throw new Error(createError?.message ?? "Could not create appointment chat");

  const { error: appointmentUpdateError } = await auth.adminClient
    .from("appointments")
    .update({ inquiry_id: inquiry.id })
    .eq("id", appointment.id);
  if (appointmentUpdateError) throw new Error(appointmentUpdateError.message);

  return inquiry.id as string;
}

export async function POST(request: Request, { params }: Params) {
  const auth = await requireUser(request);
  if (auth instanceof Response) return auth;

  const body = appointmentRescheduleCreateSchema.safeParse(await request.json());
  if (!body.success) return fail("Invalid reschedule payload", 422, body.error.flatten());

  const proposedStartsAt = new Date(body.data.starts_at);
  const proposedEndsAt = new Date(body.data.ends_at);

  if (proposedStartsAt.getTime() <= Date.now()) return fail("Choose a future appointment time", 422);
  if (proposedEndsAt <= proposedStartsAt) return fail("End time must be after start time", 422);

  const { data: appointment, error: appointmentError } = await auth.adminClient
    .from("appointments")
    .select("id, client_id, professional_id, service_id, inquiry_id, starts_at, ends_at, status")
    .eq("id", params.appointmentId)
    .single();

  if (appointmentError || !appointment) return fail("Appointment not found", 404, appointmentError?.message);
  if (!canUseAppointment(appointment, auth)) return fail("Forbidden for this appointment", 403);
  if (appointment.status !== "accepted") return fail("Only accepted appointments can be rescheduled", 409);

  const { data: existingPending, error: pendingError } = await auth.adminClient
    .from("appointment_reschedule_requests")
    .select("id")
    .eq("appointment_id", appointment.id)
    .eq("status", "pending")
    .maybeSingle();

  if (pendingError) return fail("Could not check pending reschedule", 400, pendingError.message);
  if (existingPending) return fail("A reschedule request is already pending", 409);

  const requestedFor = auth.userId === appointment.client_id
    ? appointment.professional_id
    : appointment.client_id;

  let inquiryId: string;
  try {
    inquiryId = await ensureInquiry(auth, appointment);
  } catch (err) {
    return fail("Could not open appointment chat", 400, err instanceof Error ? err.message : undefined);
  }

  const { data: rescheduleRequest, error: createError } = await auth.adminClient
    .from("appointment_reschedule_requests")
    .insert({
      appointment_id: appointment.id,
      requested_by: auth.userId,
      requested_for: requestedFor,
      previous_starts_at: appointment.starts_at,
      previous_ends_at: appointment.ends_at,
      proposed_starts_at: body.data.starts_at,
      proposed_ends_at: body.data.ends_at,
      note: body.data.note ?? null,
      status: "pending"
    })
    .select("*")
    .single();

  if (createError || !rescheduleRequest) return fail("Could not request reschedule", 400, createError?.message);

  const messageBody = [
    `Reschedule requested: ${proposedStartsAt.toLocaleString()} - ${proposedEndsAt.toLocaleString()}.`,
    body.data.note ? `Note: ${body.data.note}` : null
  ].filter(Boolean).join("\n");

  const { data: message, error: messageError } = await auth.adminClient
    .from("messages")
    .insert({
      inquiry_id: inquiryId,
      sender_id: auth.userId,
      receiver_id: requestedFor,
      body: messageBody
    })
    .select("*, sender:profiles!messages_sender_id_fkey(id, first_name, last_name, avatar_url), receiver:profiles!messages_receiver_id_fkey(id, first_name, last_name, avatar_url)")
    .single();

  if (messageError) return fail("Reschedule requested, but chat notice could not be sent", 400, messageError.message);

  await auth.adminClient.from("appointment_audit_logs").insert({
    appointment_id: appointment.id,
    availability_id: null,
    client_id: appointment.client_id,
    professional_id: appointment.professional_id,
    actor_id: auth.userId,
    action: "reschedule_requested",
    previous_status: appointment.status,
    next_status: appointment.status,
    metadata: {
      reschedule_request_id: rescheduleRequest.id,
      previous_starts_at: appointment.starts_at,
      previous_ends_at: appointment.ends_at,
      proposed_starts_at: body.data.starts_at,
      proposed_ends_at: body.data.ends_at,
      inquiry_id: inquiryId
    }
  });

  await auth.adminClient.from("notifications").insert({
    user_id: requestedFor,
    type: "appointment_reschedule_requested",
    title: "Appointment reschedule requested",
    body: "A new appointment time has been proposed. Review it in chat.",
    data: {
      appointment_id: appointment.id,
      inquiry_id: inquiryId,
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

  return created({ appointment: updatedAppointment, reschedule_request: rescheduleRequest, message });
}
