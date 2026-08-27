import { fail, ok } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { hasCompletedPasswordLog, recordPasswordLog } from "@/lib/password-log";
import { passwordSchema } from "@/lib/validators";
import { z } from "zod";

const resetPasswordSchema = z.object({
  password: passwordSchema
});

export async function POST(request: Request) {
  const auth = await requireUser(request, { enforceAppSession: false });
  if (auth instanceof Response) return auth;

  const body = resetPasswordSchema.safeParse(await request.json());
  if (!body.success) return fail("Invalid reset password payload", 422, body.error.flatten());

  const { data: profile, error: profileError } = await auth.adminClient
    .from("profiles")
    .select("email")
    .eq("id", auth.userId)
    .single();

  if (profileError) return fail("Could not load account", 400, profileError.message);

  const hasPasswordLog = await hasCompletedPasswordLog(auth.userId);
  if (!hasPasswordLog) {
    await recordPasswordLog({
      userId: auth.userId,
      email: profile.email,
      eventType: "password_reset_blocked",
      status: "blocked",
      hasPassword: false,
      request,
      metadata: { reason: "no_existing_password_record" }
    });
    return fail("This account does not have a password yet. Please sign in with Google.", 400);
  }

  const { error } = await auth.adminClient.auth.admin.updateUserById(auth.userId, {
    password: body.data.password
  });

  if (error) {
    await recordPasswordLog({
      userId: auth.userId,
      email: profile.email,
      eventType: "password_reset_completed",
      status: "failed",
      hasPassword: true,
      request,
      metadata: { reason: error.message }
    });
    return fail("Could not reset password", 400, error.message);
  }

  await recordPasswordLog({
    userId: auth.userId,
    email: profile.email,
    eventType: "password_reset_completed",
    hasPassword: true,
    request
  });

  return ok({ message: "Password updated successfully." });
}
