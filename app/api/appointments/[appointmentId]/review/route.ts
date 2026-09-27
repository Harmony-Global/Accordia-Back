import { fail, ok } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { conversationReviewSchema } from "@/lib/validators";

type Params = { params: { appointmentId: string } };

export async function POST(request: Request, { params }: Params) {
  const auth = await requireRole(request, ["client"]);
  if (auth instanceof Response) return auth;
  const body = conversationReviewSchema.safeParse(await request.json());
  if (!body.success) return fail("Invalid review", 422, body.error.flatten());

  const { data: appointment, error } = await auth.adminClient
    .from("appointments")
    .select("id, client_id, professional_id, status, payment_made_at")
    .eq("id", params.appointmentId)
    .single();
  if (error || !appointment) return fail("Appointment not found", 404, error?.message);
  if (appointment.client_id !== auth.userId) return fail("Only the client can review this appointment", 403);
  if (appointment.status !== "completed" || !appointment.payment_made_at) {
    return fail("This appointment must be completed and paid before review", 409);
  }
  const { data: existing, error: existingError } = await auth.adminClient
    .from("appointment_reviews")
    .select("*")
    .eq("appointment_id", appointment.id)
    .maybeSingle();
  if (existingError) return fail("Could not check review", 400, existingError.message);
  if (existing) return ok({ review: existing });

  const { data: review, error: insertError } = await auth.adminClient
    .from("appointment_reviews")
    .insert({
      appointment_id: appointment.id,
      client_id: appointment.client_id,
      professional_id: appointment.professional_id,
      rating: body.data.skipped ? null : body.data.rating,
      review_text: body.data.skipped ? null : body.data.review_text?.trim() || null,
      skipped: body.data.skipped
    })
    .select("*")
    .single();
  if (insertError || !review) return fail("Could not save appointment review", 409, insertError?.message);
  return ok({ review });
}
