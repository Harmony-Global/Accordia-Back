import { fail, ok } from "@/lib/api";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { createSupabasePublic } from "@/lib/supabase/public";
import { z } from "zod";

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1)
});

export async function POST(request: Request) {
  const body = loginSchema.safeParse(await request.json());
  if (!body.success) return fail("Invalid login payload", 422, body.error.flatten());

  const publicClient = createSupabasePublic();
  const { data, error } = await publicClient.auth.signInWithPassword(body.data);
  if (error || !data.user || !data.session) {
    return fail(error?.message ?? "Invalid credentials", 401);
  }

  const adminClient = createSupabaseAdmin();
  const { data: profile, error: profileError } = await adminClient
    .from("profiles")
    .select("*")
    .eq("id", data.user.id)
    .single();

  if (profileError) return fail("Profile not found", 403);

  return ok({ user: data.user, profile, session: data.session });
}
