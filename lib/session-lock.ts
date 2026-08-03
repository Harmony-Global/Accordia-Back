import { fail } from "@/lib/api";
import type { createSupabaseAdmin } from "@/lib/supabase/admin";

export const APP_SESSION_HEADER = "x-accordia-session-id";

type SupabaseAdminClient = ReturnType<typeof createSupabaseAdmin>;

function requestUserAgent(request: Request) {
  return request.headers.get("user-agent");
}

function requestIpAddress(request: Request) {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    ?? request.headers.get("x-real-ip")
    ?? null;
}

export function getAppSessionId(request: Request) {
  return request.headers.get(APP_SESSION_HEADER);
}

export async function issueAppSession(adminClient: SupabaseAdminClient, userId: string, request: Request) {
  const sessionId = crypto.randomUUID();
  const userAgent = requestUserAgent(request);
  const ipAddress = requestIpAddress(request);

  const { data: existingSession } = await adminClient
    .from("active_user_sessions")
    .select("session_id")
    .eq("user_id", userId)
    .maybeSingle();

  const { error } = await adminClient.from("active_user_sessions").upsert({
    user_id: userId,
    session_id: sessionId,
    user_agent: userAgent,
    ip_address: ipAddress,
    updated_at: new Date().toISOString()
  }, { onConflict: "user_id" });

  if (error) throw new Error(error.message);

  const eventType = existingSession?.session_id ? "session_replaced" : "session_started";
  const { error: auditError } = await adminClient.from("user_session_audit_logs").insert({
    user_id: userId,
    session_id: sessionId,
    event_type: eventType,
    user_agent: userAgent,
    ip_address: ipAddress
  });

  if (auditError) {
    console.warn("Failed to record session audit log", auditError.message);
  }

  return sessionId;
}

export async function ensureActiveAppSession(adminClient: SupabaseAdminClient, userId: string, request: Request) {
  const requestSessionId = getAppSessionId(request);
  if (!requestSessionId) return fail("Missing app session. Please log in again.", 401);

  const { data: activeSession, error } = await adminClient
    .from("active_user_sessions")
    .select("session_id")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) return fail("Could not verify session", 401, error.message);
  if (!activeSession || activeSession.session_id !== requestSessionId) {
    return fail("This account was signed in from another device. Please log in again.", 401);
  }

  return null;
}
