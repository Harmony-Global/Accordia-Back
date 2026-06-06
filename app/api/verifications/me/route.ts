import { fail, ok } from "@/lib/api";
import { requireUser } from "@/lib/auth";

export async function GET(request: Request) {
  const auth = await requireUser(request);
  if (auth instanceof Response) return auth;

  const { data, error } = await auth.userClient
    .from("verifications")
    .select("id,type,value,status,reviewed_at,created_at,last_sent_at,otp_expires_at")
    .eq("user_id", auth.userId)
    .order("created_at", { ascending: false });

  if (error) return fail("Could not load verifications", 400, error.message);
  return ok({ verifications: data });
}
