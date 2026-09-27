import { fail, ok } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { availabilityUpdateSchema } from "@/lib/validators";

type Params = { params: { availabilityId: string } };

export async function PATCH(request: Request, { params }: Params) {
  const auth = await requireRole(request, ["professional"]);
  if (auth instanceof Response) return auth;
  const body = availabilityUpdateSchema.safeParse(await request.json());
  if (!body.success) return fail("Invalid slot update", 422, body.error.flatten());
  const edit = body.data.action === "edit" ? body.data : null;
  const { data: updated, error: updateError } = await auth.userClient.rpc("update_professional_availability", {
    p_availability_id: params.availabilityId,
    p_action: body.data.action,
    p_service_id: edit?.service_id ?? null,
    p_starts_at: edit?.starts_at ?? null,
    p_ends_at: edit?.ends_at ?? null,
    p_note: edit?.note ?? null,
    p_capacity: edit?.capacity ?? null
  });
  if (updateError || !updated) return fail(updateError?.message ?? "Could not update slot", 409);
  const { data: availability, error } = await auth.adminClient
    .from("professional_availability")
    .select("*, service:professional_services(*)")
    .eq("id", params.availabilityId)
    .single();
  if (error || !availability) return fail("Could not load updated slot", 400, error?.message);
  return ok({ availability });
}

export async function DELETE(request: Request, { params }: Params) {
  const auth = await requireRole(request, ["professional"]);
  if (auth instanceof Response) return auth;

  const { data: availability, error: loadError } = await auth.adminClient
    .from("professional_availability")
    .select("id, professional_id, status")
    .eq("id", params.availabilityId)
    .single();

  if (loadError || !availability) return fail("Availability not found", 404, loadError?.message);
  if (availability.professional_id !== auth.userId) return fail("Forbidden for this availability", 403);
  if (availability.status === "booked") return fail("Booked availability cannot be removed", 409);
  const { count, error: bookingError } = await auth.adminClient
    .from("appointments")
    .select("id", { count: "exact", head: true })
    .eq("availability_id", params.availabilityId);
  if (bookingError) return fail("Could not check slot bookings", 400, bookingError.message);
  if (count) return fail("Slots with booking history cannot be removed", 409);

  const { error } = await auth.adminClient
    .from("professional_availability")
    .delete()
    .eq("id", params.availabilityId);

  if (error) return fail("Could not remove availability", 400, error.message);
  return ok({ deleted: true, availability_id: params.availabilityId });
}
