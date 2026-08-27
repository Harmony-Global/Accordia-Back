import { created, fail, ok } from "@/lib/api";
import { requireRole, requireUser } from "@/lib/auth";
import { appointmentCreateSchema } from "@/lib/validators";

const appointmentSelect = "*, client:profiles!appointments_client_id_fkey(id, first_name, last_name, avatar_url, phone_verified), professional:profiles!appointments_professional_id_fkey(id, first_name, last_name, avatar_url, phone_verified, professional_profiles(*, professional_categories(category:categories(*)), professional_services(*, category:categories(*)))), service:professional_services(*), availability:professional_availability(*), reschedule_requests:appointment_reschedule_requests(*)";

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

  return ok({ appointments: data });
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
