import { fail, ok } from "@/lib/api";
import { env } from "@/lib/env";
import {
  hasCompletedPasswordLog,
  recordPasswordLog,
  userHasPasswordProvider
} from "@/lib/password-log";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { createSupabasePublic } from "@/lib/supabase/public";
import { z } from "zod";

const forgotPasswordSchema = z.object({
  email: z.string().email(),
  redirect_to: z.string().url().optional()
});

function resetRedirectUrl(input?: string) {
  if (input) return input;
  if (env.passwordResetRedirectUrl) return env.passwordResetRedirectUrl;
  if (env.appFrontendUrl) return `${env.appFrontendUrl.replace(/\/$/, "")}/reset-password`;
  return undefined;
}

export async function POST(request: Request) {
  const body = forgotPasswordSchema.safeParse(await request.json());
  if (!body.success) return fail("Invalid forgot password payload", 422, body.error.flatten());

  const email = body.data.email.trim().toLowerCase();
  const adminClient = createSupabaseAdmin();
  const { data: profile, error: profileError } = await adminClient
    .from("profiles")
    .select("id,email,is_active")
    .ilike("email", email)
    .limit(1)
    .maybeSingle();

  if (profileError) return fail("Could not check account", 400, profileError.message);

  if (!profile || !profile.is_active) {
    return ok({
      message: "If an active account exists for this email, a password reset link will be sent."
    });
  }

  const { data: userResult, error: userError } = await adminClient.auth.admin.getUserById(profile.id);
  if (userError || !userResult.user) return fail("Could not check account", 400, userError?.message);

  const hasPasswordProvider = userHasPasswordProvider(userResult.user);
  const hasPasswordLog = await hasCompletedPasswordLog(profile.id);

  if (!hasPasswordProvider || !hasPasswordLog) {
    await recordPasswordLog({
      userId: profile.id,
      email: profile.email,
      eventType: "password_reset_blocked",
      status: "blocked",
      hasPassword: false,
      request,
      metadata: { reason: "no_existing_password_record", providers: userResult.user.app_metadata?.providers ?? [] }
    });

    return fail("This account does not have a password yet. Please sign in with Google.", 400);
  }

  const publicClient = createSupabasePublic();
  const { error } = await publicClient.auth.resetPasswordForEmail(profile.email, {
    redirectTo: resetRedirectUrl(body.data.redirect_to)
  });

  if (error) {
    await recordPasswordLog({
      userId: profile.id,
      email: profile.email,
      eventType: "password_reset_requested",
      status: "failed",
      hasPassword: true,
      request,
      metadata: { reason: error.message }
    });
    return fail("Could not send password reset email", 400, error.message);
  }

  await recordPasswordLog({
    userId: profile.id,
    email: profile.email,
    eventType: "password_reset_requested",
    hasPassword: true,
    request
  });

  return ok({ message: "Password reset link sent. Check your email to continue." });
}
