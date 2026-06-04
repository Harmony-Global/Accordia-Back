import { fail, ok } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { professionalProfilePatchSchema, profilePatchSchema } from "@/lib/validators";

export async function GET(request: Request) {
  const auth = await requireUser(request);
  if (auth instanceof Response) return auth;

  const { data: profile, error } = await auth.adminClient
    .from("profiles")
    .select("*, professional_profiles(*)")
    .eq("id", auth.userId)
    .single();

  if (error) return fail("Could not load profile", 400, error.message);
  return ok({ profile });
}

export async function PATCH(request: Request) {
  const auth = await requireUser(request);
  if (auth instanceof Response) return auth;

  const payload = await request.json();
  const profilePatch = profilePatchSchema.safeParse(payload.profile ?? {});
  const proPatch = professionalProfilePatchSchema.safeParse(payload.professional_profile ?? {});

  if (!profilePatch.success) return fail("Invalid profile payload", 422, profilePatch.error.flatten());
  if (!proPatch.success) return fail("Invalid professional profile payload", 422, proPatch.error.flatten());

  if (Object.keys(profilePatch.data).length > 0) {
    const { error } = await auth.adminClient.from("profiles").update(profilePatch.data).eq("id", auth.userId);
    if (error) return fail("Could not update profile", 400, error.message);
  }

  if (auth.role === "professional" && Object.keys(proPatch.data).length > 0) {
    const { error } = await auth.adminClient
      .from("professional_profiles")
      .update(proPatch.data)
      .eq("user_id", auth.userId);
    if (error) return fail("Could not update professional profile", 400, error.message);
  }

  return ok({ updated: true });
}
