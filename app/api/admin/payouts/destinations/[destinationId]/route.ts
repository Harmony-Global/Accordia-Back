import { fail, ok } from "@/lib/api";
import { requireRole } from "@/lib/auth";

type Params = { params: { destinationId: string } };

export async function PATCH(request: Request, { params }: Params) {
  const auth = await requireRole(request, ["admin"]);
  if (auth instanceof Response) return auth;
  const { data: destination, error } = await auth.adminClient.from("payout_destinations")
    .select("id,professional_id,status,is_current").eq("id", params.destinationId).maybeSingle();
  if (error || !destination) return fail("Destination not found", 404);
  if (!destination.is_current || destination.status !== "pending_review") return fail("Destination is not awaiting review", 409);
  const result = await auth.adminClient.rpc("approve_payout_destination", { p_destination_id: destination.id });
  if (result.error) return fail("Could not approve destination", 409, result.error.message);
  return ok({ approved: true });
}
