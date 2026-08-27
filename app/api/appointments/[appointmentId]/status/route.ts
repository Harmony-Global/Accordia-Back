import { fail, ok } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { appointmentStatusSchema } from "@/lib/validators";

type Params = { params: { appointmentId: string } };
const appointmentSelect = "*, client:profiles!appointments_client_id_fkey(id, first_name, last_name, avatar_url, phone_verified), professional:profiles!appointments_professional_id_fkey(id, first_name, last_name, avatar_url, phone_verified, professional_profiles(*, professional_categories(category:categories(*)), professional_services(*, category:categories(*)))), service:professional_services(*), availability:professional_availability(*), reschedule_requests:appointment_reschedule_requests(*)";

export async function PATCH(request: Request, { params }: Params) {
  const auth = await requireUser(request);
  if (auth instanceof Response) return auth;

  const body = appointmentStatusSchema.safeParse(await request.json());
  if (!body.success) return fail("Invalid appointment status", 422, body.error.flatten());

  const { data: updatedAppointment, error: rpcError } = await auth.userClient.rpc("update_appointment_status", {
    p_appointment_id: params.appointmentId,
    p_status: body.data.status
  });

  if (rpcError || !updatedAppointment) {
    return fail(rpcError?.message ?? "Could not update appointment", 400);
  }

  const { data: appointment, error } = await auth.adminClient
    .from("appointments")
    .select(appointmentSelect)
    .eq("id", updatedAppointment.id)
    .single();

  if (error || !appointment) return fail("Could not load appointment", 400, error?.message);

  return ok({ appointment });
}
