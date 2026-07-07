import { fail, ok } from "@/lib/api";
import { requireRole } from "@/lib/auth";

type Params = { params: { availabilityId: string } };

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

  const { error } = await auth.adminClient
    .from("professional_availability")
    .delete()
    .eq("id", params.availabilityId);

  if (error) return fail("Could not remove availability", 400, error.message);
  return ok({ deleted: true, availability_id: params.availabilityId });
}
