import { fail, ok } from "@/lib/api";
import { ensureActiveAppSession, getAppSessionId } from "@/lib/session-lock";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { createSupabasePublic } from "@/lib/supabase/public";
import { z } from "zod";

const refreshSchema = z.object({
  refresh_token: z.string().min(1)
});

export async function POST(request: Request) {
  const body = refreshSchema.safeParse(await request.json());
  if (!body.success) return fail("Invalid refresh payload", 422, body.error.flatten());

  const appSessionId = getAppSessionId(request);
  if (!appSessionId) return fail("Missing app session. Please log in again.", 401);

  const publicClient = createSupabasePublic();
  const { data, error } = await publicClient.auth.refreshSession({
    refresh_token: body.data.refresh_token
  });

  if (error || !data.session || !data.user) {
    return fail(error?.message ?? "Invalid or expired session", 401);
  }

  const adminClient = createSupabaseAdmin();
  const { data: profile, error: profileError } = await adminClient
    .from("profiles")
    .select("*, professional_profile:professional_profiles(*)")
    .eq("id", data.user.id)
    .single();

  if (profileError || !profile?.is_active) {
    return fail("Profile not found or inactive", 403);
  }

  const sessionError = await ensureActiveAppSession(adminClient, data.user.id, request);
  if (sessionError) return sessionError;

  return ok({
    user: data.user,
    profile,
    session: data.session,
    app_session_id: appSessionId
  });
}
