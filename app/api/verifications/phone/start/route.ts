import { fail, ok } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { createOtpCode, hashOtpCode, otpExpiresAt } from "@/lib/otp";
import { phoneVerificationStartSchema } from "@/lib/validators";

export async function POST(request: Request) {
  const auth = await requireUser(request);
  if (auth instanceof Response) return auth;

  const body = phoneVerificationStartSchema.safeParse(await request.json());
  if (!body.success) return fail("Invalid phone verification payload", 422, body.error.flatten());

  const { data: profile, error: profileError } = await auth.adminClient
    .from("profiles")
    .select("phone")
    .eq("id", auth.userId)
    .single();

  if (profileError) return fail("Could not load profile phone", 400, profileError.message);

  const phone = body.data.phone ?? profile.phone;
  const code = createOtpCode();
  const otpHash = hashOtpCode(auth.userId, phone, code);

  const { data: verification, error } = await auth.adminClient
    .from("verifications")
    .upsert(
      {
        user_id: auth.userId,
        type: "phone",
        value: phone,
        status: "pending",
        otp_hash: otpHash,
        otp_expires_at: otpExpiresAt(),
        otp_attempts: 0,
        last_sent_at: new Date().toISOString(),
        reviewed_by: null,
        reviewed_at: null
      },
      { onConflict: "user_id,type" }
    )
    .select("id,type,value,status,otp_expires_at,last_sent_at,created_at")
    .single();

  if (error) return fail("Could not start phone verification", 400, error.message);

  return ok({
    verification,
    ...(process.env.NODE_ENV !== "production" ? { dev_code: code } : {})
  });
}
