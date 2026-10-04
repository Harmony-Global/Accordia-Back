import { created, fail } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { z } from "zod";

type Params = { params: { professionalId: string } };
const viewSchema = z.object({ view_key: z.string().uuid() }).strict();

export async function POST(request: Request, { params }: Params) {
  const auth = await requireRole(request, ["client"]);
  if (auth instanceof Response) return auth;
  if (!z.string().uuid().safeParse(params.professionalId).success) return fail("Invalid professional ID", 422);
  const body = viewSchema.safeParse(await request.json());
  if (!body.success) return fail("Invalid profile view", 422, body.error.flatten());

  const { data: professional, error: profileError } = await auth.adminClient.from("profiles")
    .select("id").eq("id", params.professionalId).eq("role", "professional").eq("is_active", true).single();
  if (profileError || !professional) return fail("Professional not found", 404);
  const { error } = await auth.adminClient.from("professional_profile_views").upsert({
    view_key: body.data.view_key, client_id: auth.userId, professional_id: professional.id
  }, { onConflict: "view_key", ignoreDuplicates: true });
  if (error) return fail("Could not record profile view", 400, error.message);
  return created({ recorded: true });
}
