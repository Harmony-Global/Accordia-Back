import { created, fail, ok } from "@/lib/api";
import { requireRole, requireUser } from "@/lib/auth";
import { appointmentCreateSchema } from "@/lib/validators";

const appointmentSelect = "*, client:profiles!appointments_client_id_fkey(id, first_name, last_name, avatar_url, phone_verified), professional:profiles!appointments_professional_id_fkey(id, first_name, last_name, avatar_url, phone_verified, professional_profiles(*, professional_categories(category:categories(*)), professional_services(*, category:categories(*)))), service:professional_services(*), availability:professional_availability(*), reschedule_requests:appointment_reschedule_requests(*)";

type AppointmentListItem = {
  id: string;
  inquiry_id?: string | null;
  starts_at: string;
  updated_at: string;
  status: string;
  [key: string]: unknown;
};

type UnreadMessage = {
  appointment_id?: string | null;
  inquiry_id?: string | null;
};

type UnreadNotification = {
  id: string;
  type: string;
  data?: { appointment_id?: unknown } | null;
};

async function attachAppointmentActivity(
  appointments: AppointmentListItem[],
  auth: Exclude<Awaited<ReturnType<typeof requireUser>>, Response>
) {
  if (appointments.length === 0) return appointments;

  const appointmentIds = new Set(appointments.map((appointment) => appointment.id));
  const appointmentsByInquiry = new Map<string, AppointmentListItem[]>();

  for (const appointment of appointments) {
    if (!appointment.inquiry_id) continue;
    const related = appointmentsByInquiry.get(appointment.inquiry_id) ?? [];
    related.push(appointment);
    appointmentsByInquiry.set(appointment.inquiry_id, related);
  }

  for (const related of appointmentsByInquiry.values()) {
    related.sort((first, second) => {
      const firstClosed = ["cancelled", "declined", "completed"].includes(first.status);
      const secondClosed = ["cancelled", "declined", "completed"].includes(second.status);
      if (firstClosed !== secondClosed) return firstClosed ? 1 : -1;
      return new Date(second.updated_at ?? second.starts_at).getTime() - new Date(first.updated_at ?? first.starts_at).getTime();
    });
  }

  const [{ data: unreadMessages, error: messageError }, { data: unreadNotifications, error: notificationError }] = await Promise.all([
    auth.adminClient
      .from("messages")
      .select("appointment_id, inquiry_id")
      .eq("receiver_id", auth.userId)
      .eq("is_read", false)
      .limit(1000),
    auth.adminClient
      .from("notifications")
      .select("id, type, data")
      .eq("user_id", auth.userId)
      .eq("is_read", false)
      .order("created_at", { ascending: false })
      .limit(500)
  ]);

  if (messageError) throw new Error(messageError.message);
  if (notificationError) throw new Error(notificationError.message);

  const messageCounts = new Map<string, number>();
  for (const message of (unreadMessages ?? []) as UnreadMessage[]) {
    let appointmentId = message.appointment_id ?? null;
    if (!appointmentId && message.inquiry_id) {
      appointmentId = appointmentsByInquiry.get(message.inquiry_id)?.[0]?.id ?? null;
    }
    if (!appointmentId || !appointmentIds.has(appointmentId)) continue;
    messageCounts.set(appointmentId, (messageCounts.get(appointmentId) ?? 0) + 1);
  }

  const updateIds = new Map<string, string[]>();
  for (const notification of (unreadNotifications ?? []) as UnreadNotification[]) {
    if (notification.type === "appointment_message") continue;
    const appointmentId = typeof notification.data?.appointment_id === "string"
      ? notification.data.appointment_id
      : null;
    if (!appointmentId || !appointmentIds.has(appointmentId)) continue;
    const related = updateIds.get(appointmentId) ?? [];
    related.push(notification.id);
    updateIds.set(appointmentId, related);
  }

  return appointments.map((appointment) => ({
    ...appointment,
    unread_message_count: messageCounts.get(appointment.id) ?? 0,
    unread_update_count: updateIds.get(appointment.id)?.length ?? 0,
    unread_update_notification_ids: updateIds.get(appointment.id) ?? []
  }));
}

export async function GET(request: Request) {
  const auth = await requireUser(request);
  if (auth instanceof Response) return auth;

  let query = auth.adminClient
    .from("appointments")
    .select(appointmentSelect)
    .order("starts_at", { ascending: true });

  if (auth.role === "client") query = query.eq("client_id", auth.userId);
  if (auth.role === "professional") query = query.eq("professional_id", auth.userId);

  const { data, error } = await query;
  if (error) return fail("Could not load appointments", 400, error.message);

  try {
    const appointments = await attachAppointmentActivity((data ?? []) as AppointmentListItem[], auth);
    return ok({ appointments });
  } catch (activityError) {
    return fail("Could not load appointment activity", 400, activityError instanceof Error ? activityError.message : undefined);
  }
}

export async function POST(request: Request) {
  const auth = await requireRole(request, ["client"]);
  if (auth instanceof Response) return auth;

  const body = appointmentCreateSchema.safeParse(await request.json());
  if (!body.success) return fail("Invalid appointment payload", 422, body.error.flatten());

  const { data: requestedAppointment, error: rpcError } = await auth.userClient.rpc("request_appointment", {
    p_availability_id: body.data.availability_id,
    p_service_id: body.data.service_id ?? null,
    p_inquiry_id: body.data.inquiry_id ?? null,
    p_note: body.data.note ?? null
  });

  if (rpcError || !requestedAppointment) {
    return fail(rpcError?.message ?? "Could not request appointment", 400);
  }

  const { data: appointment, error: appointmentError } = await auth.adminClient
    .from("appointments")
    .select(appointmentSelect)
    .eq("id", requestedAppointment.id)
    .single();

  if (appointmentError || !appointment) return fail("Could not load appointment", 400, appointmentError?.message);

  return created({ appointment });
}
