import { fail, ok } from "@/lib/api";
import { requireUser } from "@/lib/auth";

type Params = { params: { appointmentId: string } };

const inquirySelect = "*, client:profiles!professional_inquiries_client_id_fkey(id, first_name, last_name, avatar_url, phone_verified), professional:profiles!professional_inquiries_professional_id_fkey(id, first_name, last_name, avatar_url, phone_verified, professional_profiles(*, professional_categories(category:categories(*)), professional_services(*, category:categories(*)))), service:professional_services(*)";

function canUseAppointment(
  appointment: { client_id: string; professional_id: string },
  auth: { role: string; userId: string }
) {
  return auth.role === "admin"
    || appointment.client_id === auth.userId
    || appointment.professional_id === auth.userId;
}

export async function POST(request: Request, { params }: Params) {
  const auth = await requireUser(request);
  if (auth instanceof Response) return auth;

  const { data: appointment, error: appointmentError } = await auth.adminClient
    .from("appointments")
    .select("id, client_id, professional_id, service_id, inquiry_id, status")
    .eq("id", params.appointmentId)
    .single();

  if (appointmentError || !appointment) return fail("Appointment not found", 404, appointmentError?.message);
  if (!canUseAppointment(appointment, auth)) return fail("Forbidden for this appointment", 403);
  if (!["accepted", "completed"].includes(appointment.status)) {
    return fail("Chat is available after the appointment is accepted", 409);
  }

  let inquiryId = appointment.inquiry_id as string | null;

  if (!inquiryId) {
    const { data: existingInquiry, error: existingInquiryError } = await auth.adminClient
      .from("professional_inquiries")
      .select("id")
      .eq("client_id", appointment.client_id)
      .eq("professional_id", appointment.professional_id)
      .or(appointment.service_id ? `service_id.eq.${appointment.service_id}` : "service_id.is.null")
      .maybeSingle();

    if (existingInquiryError) return fail("Could not check appointment chat", 400, existingInquiryError.message);

    if (existingInquiry) {
      inquiryId = existingInquiry.id;
      const { error: reopenError } = await auth.adminClient
        .from("professional_inquiries")
        .update({ status: "open" })
        .eq("id", inquiryId);
      if (reopenError) return fail("Could not open appointment chat", 400, reopenError.message);
    } else {
      const { data: newInquiry, error: createError } = await auth.adminClient
        .from("professional_inquiries")
        .insert({
          client_id: appointment.client_id,
          professional_id: appointment.professional_id,
          service_id: appointment.service_id,
          status: "open"
        })
        .select("id")
        .single();

      if (createError || !newInquiry) return fail("Could not open appointment chat", 400, createError?.message);
      inquiryId = newInquiry.id;
    }

    const { error: appointmentUpdateError } = await auth.adminClient
      .from("appointments")
      .update({ inquiry_id: inquiryId })
      .eq("id", appointment.id);

    if (appointmentUpdateError) return fail("Could not link appointment chat", 400, appointmentUpdateError.message);
  }

  const { data: inquiry, error: inquiryError } = await auth.adminClient
    .from("professional_inquiries")
    .select(inquirySelect)
    .eq("id", inquiryId)
    .single();

  if (inquiryError || !inquiry) return fail("Could not load appointment chat", 400, inquiryError?.message);

  return ok({ inquiry });
}
