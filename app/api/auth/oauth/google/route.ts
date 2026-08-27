import { fail, ok } from "@/lib/api";
import { createSupabasePublic } from "@/lib/supabase/public";
import { z } from "zod";

const googleOAuthSchema = z.object({
  redirect_to: z.string().url()
});

export async function POST(request: Request) {
  const body = googleOAuthSchema.safeParse(await request.json());
  if (!body.success) return fail("Invalid Google auth payload", 422, body.error.flatten());

  const publicClient = createSupabasePublic();
  const { data, error } = await publicClient.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: body.data.redirect_to,
      queryParams: {
        access_type: "offline",
        prompt: "select_account"
      }
    }
  });

  if (error || !data.url) return fail("Could not start Google sign-in", 400, error?.message);

  return ok({ url: data.url });
}
