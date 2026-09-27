import { created, fail, ok, parseSearchParams } from "@/lib/api";
import { requireRole, requireUser } from "@/lib/auth";
import { availabilityCreateSchema } from "@/lib/validators";

export async function GET(request: Request) {
  const auth = await requireUser(request);
  if (auth instanceof Response) return auth;

  const params = parseSearchParams(request);
  const requestedProfessionalId = params.get("professional_id");
  const professionalId = requestedProfessionalId ?? (auth.role === "professional" ? auth.userId : null);

  if (!professionalId) return fail("professional_id is required", 422);

  let query = auth.adminClient
    .from("professional_availability")
    .select("*, service:professional_services(*)")
    .eq("professional_id", professionalId)
    .order("starts_at", { ascending: true });

  if (auth.role !== "admin" && professionalId !== auth.userId) {
    query = query.eq("status", "open").gt("starts_at", new Date().toISOString());
  }

  const { data, error } = await query;
  if (error) return fail("Could not load availability", 400, error.message);
  const slotIds = (data ?? []).map((slot) => slot.id);
  if (slotIds.length === 0) return ok({ availability: [] });
  const { data: linked, error: linkedError } = await auth.adminClient
    .from("appointments")
    .select("availability_id, client_id, status")
    .in("availability_id", slotIds);
  if (linkedError) return fail("Could not load slot bookings", 400, linkedError.message);
  const confirmed = new Map<string, number>();
  const ownActive = new Set<string>();
  const hasBookings = new Set<string>();
  for (const appointment of linked ?? []) {
    if (!appointment.availability_id) continue;
    hasBookings.add(appointment.availability_id);
    if (["accepted", "completed"].includes(appointment.status)) {
      confirmed.set(appointment.availability_id, (confirmed.get(appointment.availability_id) ?? 0) + 1);
    }
    if (appointment.client_id === auth.userId && ["requested", "accepted"].includes(appointment.status)) {
      ownActive.add(appointment.availability_id);
    }
  }
  const availability = (data ?? [])
    .map((slot) => {
      const service = Array.isArray(slot.service) ? slot.service[0] : slot.service;
      const price = Number(service?.price_min);
      const fixedService = Boolean(service?.is_active && Number.isFinite(price) && price > 0 && Number(service?.price_max) === price);
      return {
        ...slot,
        status: slot.status === "open" && !fixedService ? "blocked" : slot.status,
        confirmed_count: confirmed.get(slot.id) ?? 0,
        remaining_count: Math.max(0, Number(slot.capacity) - (confirmed.get(slot.id) ?? 0)),
        has_bookings: hasBookings.has(slot.id)
      };
    })
    .filter((slot) => auth.role !== "client" || (slot.status === "open" && !ownActive.has(slot.id)));

  return ok({ availability });
}

export async function POST(request: Request) {
  const auth = await requireRole(request, ["professional"]);
  if (auth instanceof Response) return auth;

  const body = availabilityCreateSchema.safeParse(await request.json());
  if (!body.success) return fail("Invalid availability payload", 422, body.error.flatten());

  const startsAt = new Date(body.data.starts_at);
  const endsAt = new Date(body.data.ends_at);
  if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime()) || endsAt <= startsAt) {
    return fail("Availability end time must be after start time", 422);
  }
  if (startsAt <= new Date()) return fail("Availability must be in the future", 422);

  const { data: createdAvailability, error: rpcError } = await auth.userClient.rpc("create_professional_availability", {
    p_service_id: body.data.service_id,
    p_starts_at: startsAt.toISOString(),
    p_ends_at: endsAt.toISOString(),
    p_note: body.data.note ?? null,
    p_capacity: body.data.capacity
  });

  if (rpcError || !createdAvailability) {
    return fail(rpcError?.message ?? "Could not create availability", 400);
  }

  const { data, error } = await auth.adminClient
    .from("professional_availability")
    .select("*, service:professional_services(*)")
    .eq("id", createdAvailability.id)
    .single();

  if (error || !data) return fail("Could not load created availability", 400, error?.message);
  return created({ availability: data });
}
