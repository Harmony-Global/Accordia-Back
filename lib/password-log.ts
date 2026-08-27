import type { User } from "@supabase/supabase-js";
import { createSupabaseAdmin } from "@/lib/supabase/admin";

type PasswordLogEvent =
  | "password_created"
  | "password_reset_requested"
  | "password_reset_completed"
  | "password_reset_blocked";

type PasswordLogStatus = "completed" | "blocked" | "failed";

export function getRequestMeta(request: Request) {
  return {
    ip_address:
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
      request.headers.get("x-real-ip") ??
      null,
    user_agent: request.headers.get("user-agent")
  };
}

export function userHasPasswordProvider(user: User) {
  const providers = user.app_metadata?.providers;
  if (Array.isArray(providers) && providers.includes("email")) return true;
  if (user.app_metadata?.provider === "email") return true;
  return user.identities?.some((identity) => identity.provider === "email") ?? false;
}

export async function hasCompletedPasswordLog(userId: string) {
  const adminClient = createSupabaseAdmin();
  const { count, error } = await adminClient
    .from("password_logs")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .in("event_type", ["password_created", "password_reset_completed"])
    .eq("status", "completed")
    .eq("has_password", true);

  if (error) throw error;
  return Boolean(count);
}

export async function recordPasswordLog(input: {
  userId?: string | null;
  email: string;
  eventType: PasswordLogEvent;
  status?: PasswordLogStatus;
  hasPassword: boolean;
  request?: Request;
  metadata?: Record<string, unknown>;
}) {
  const adminClient = createSupabaseAdmin();
  const requestMeta = input.request ? getRequestMeta(input.request) : { ip_address: null, user_agent: null };

  const { error } = await adminClient.from("password_logs").insert({
    user_id: input.userId ?? null,
    email: input.email,
    event_type: input.eventType,
    status: input.status ?? "completed",
    has_password: input.hasPassword,
    ip_address: requestMeta.ip_address,
    user_agent: requestMeta.user_agent,
    metadata: input.metadata ?? {}
  });

  if (error) {
    console.warn("Could not record password log", error.message);
  }
}
