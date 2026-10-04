import { fail, ok } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { env } from "@/lib/env";
import { z } from "zod";

const schema = z.object({ email: z.string().email().max(320) });

export async function POST(request: Request) {
  const auth = await requireUser(request);
  if (auth instanceof Response) return auth;
  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) return fail("Enter a valid email address", 422);
  if (!env.appFrontendUrl) return fail("Email confirmation redirect is not configured", 503);
  const redirect = new URL("/auth/callback?flow=email-change", env.appFrontendUrl).toString();
  const url = new URL("/auth/v1/user", env.supabaseUrl);
  url.searchParams.set("redirect_to", redirect);
  const response = await fetch(url, {
    method: "PUT",
    headers: { Authorization: `Bearer ${auth.accessToken}`, apikey: env.supabaseAnonKey,
      "Content-Type": "application/json" },
    body: JSON.stringify({ email: parsed.data.email })
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    return fail("Could not request email change", response.status, error.msg ?? error.message);
  }
  return ok({ confirmation_sent: true });
}
