import { fail, ok } from "@/lib/api";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { z } from "zod";

const oauthProfileSchema = z.object({
  role: z.enum(["professional", "client"]).optional(),
  phone: z.string().min(7).optional(),
  first_name: z.string().min(1).optional(),
  last_name: z.string().min(1).optional()
});

function splitName(fullName?: string | null) {
  const parts = fullName?.trim().split(/\s+/).filter(Boolean) ?? [];
  return {
    first_name: parts[0] ?? "",
    last_name: parts.slice(1).join(" ") || parts[0] || ""
  };
}

export async function POST(request: Request) {
  const authorization = request.headers.get("authorization");
  const accessToken = authorization?.startsWith("Bearer ") ? authorization.slice("Bearer ".length) : null;
  if (!accessToken) return fail("Missing bearer token", 401);

  const adminClient = createSupabaseAdmin();
  const { data: userData, error: userError } = await adminClient.auth.getUser(accessToken);
  if (userError || !userData.user) return fail("Invalid or expired session", 401);

  const { data: existingProfile, error: existingError } = await adminClient
    .from("profiles")
    .select("*, professional_profile:professional_profiles(*)")
    .eq("id", userData.user.id)
    .maybeSingle();

  if (existingError) return fail("Could not load profile", 400, existingError.message);
  if (existingProfile) {
    if (!existingProfile.is_active) return fail("Account is inactive", 403);
    return ok({ profile: existingProfile, needs_profile: false });
  }

  const body = oauthProfileSchema.safeParse(await request.json());
  if (!body.success) return fail("Invalid OAuth profile payload", 422, body.error.flatten());

  const email = userData.user.email;
  if (!email) return fail("Google account did not return an email address", 400);
  if (!body.data.role || !body.data.phone) {
    return ok({
      needs_profile: true,
      required: ["role", "phone"],
      user: {
        email,
        first_name: null,
        last_name: null,
        avatar_url: typeof userData.user.user_metadata?.avatar_url === "string" ? userData.user.user_metadata.avatar_url : null
      }
    });
  }

  const metadata = userData.user.user_metadata ?? {};
  const nameParts = splitName(
    typeof metadata.full_name === "string"
      ? metadata.full_name
      : typeof metadata.name === "string"
        ? metadata.name
        : null
  );

  const firstName = body.data.first_name ?? nameParts.first_name;
  const lastName = body.data.last_name ?? nameParts.last_name;

  if (!firstName || !lastName) {
    return ok({
      needs_profile: true,
      required: ["first_name", "last_name"],
      user: {
        email,
        first_name: firstName || null,
        last_name: lastName || null,
        avatar_url: typeof metadata.avatar_url === "string" ? metadata.avatar_url : null
      }
    });
  }

  const { error: profileError } = await adminClient.from("profiles").insert({
    id: userData.user.id,
    email,
    phone: body.data.phone,
    role: body.data.role,
    first_name: firstName,
    last_name: lastName,
    avatar_url: typeof metadata.avatar_url === "string" ? metadata.avatar_url : null,
    phone_verified: false
  });

  if (profileError) return fail("Could not create profile", 400, profileError.message);

  if (body.data.role === "professional") {
    const { error } = await adminClient.from("professional_profiles").insert({
      user_id: userData.user.id
    });
    if (error) {
      await adminClient.from("profiles").delete().eq("id", userData.user.id);
      return fail("Could not create professional profile", 400, error.message);
    }
  }

  const { data: profile, error: loadError } = await adminClient
    .from("profiles")
    .select("*, professional_profile:professional_profiles(*)")
    .eq("id", userData.user.id)
    .single();

  if (loadError) return fail("Profile created but could not be loaded", 400, loadError.message);
  return ok({ profile, needs_profile: false });
}
