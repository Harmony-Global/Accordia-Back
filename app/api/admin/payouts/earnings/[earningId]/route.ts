import { z } from "zod";
import { fail, ok } from "@/lib/api";
import { requireRole } from "@/lib/auth";

type Params = { params: { earningId: string } };
const patchSchema = z.object({ hold_reason: z.string().trim().min(5).max(500).nullable() });

export async function PATCH(request: Request, { params }: Params) {
  const auth = await requireRole(request, ["admin"]);
  if (auth instanceof Response) return auth;
  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return fail("Invalid hold reason", 422, parsed.error.flatten());
  const { data, error } = await auth.adminClient.from("professional_earnings")
    .update({ hold_reason: parsed.data.hold_reason }).eq("id", params.earningId)
    .select("id,hold_reason").maybeSingle();
  if (error || !data) return fail("Earning not found or could not be updated", 404, error?.message);
  return ok({ earning: data });
}
