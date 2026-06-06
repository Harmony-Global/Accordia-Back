import { fail, ok } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { hashOtpCode } from "@/lib/otp";
import { phoneVerificationConfirmSchema } from "@/lib/validators";

export async function POST(request: Request) {
  const auth = await requireUser(request);
  if (auth instanceof Response) return auth;

  const body = phoneVerificationConfirmSchema.safeParse(await request.json());
  if (!body.success) return fail("Invalid phone confirmation payload", 422, body.error.flatten());

  const { data: verification, error } = await auth.adminClient
    .from("verifications")
    .select("*")
    .eq("user_id", auth.userId)
    .eq("type", "phone")
    .single();

  if (error || !verification) return fail("Phone verification not found", 404, error?.message);
  if (verification.status === "verified") return ok({ verified: true });
  if (!verification.otp_hash || !verification.otp_expires_at) return fail("Phone verification has no active OTP", 400);
  if (new Date(verification.otp_expires_at).getTime() < Date.now()) return fail("OTP has expired", 400);
  if ((verification.otp_attempts ?? 0) >= 5) return fail("Too many OTP attempts", 429);

  const expectedHash = hashOtpCode(auth.userId, verification.value, body.data.code);
  if (expectedHash !== verification.otp_hash) {
    await auth.adminClient
      .from("verifications")
      .update({ otp_attempts: (verification.otp_attempts ?? 0) + 1 })
      .eq("id", verification.id);
    return fail("Invalid OTP code", 400);
  }

  const { data: updatedVerification, error: updateError } = await auth.userClient.rpc("verify_my_phone", {
    p_verification_id: verification.id
  });

  if (updateError) return fail("Could not verify phone", 400, updateError.message);
  return ok({ verified: true, verification: updatedVerification });
}
