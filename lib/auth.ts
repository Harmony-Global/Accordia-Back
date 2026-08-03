import { fail } from "@/lib/api";
import { ensureActiveAppSession } from "@/lib/session-lock";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { createSupabaseForToken } from "@/lib/supabase/user";

export type AccordiaRole = "professional" | "client" | "admin";

export type AuthContext = {
  userId: string;
  accessToken: string;
  role: AccordiaRole;
  userClient: ReturnType<typeof createSupabaseForToken>;
  adminClient: ReturnType<typeof createSupabaseAdmin>;
};

type RequireUserOptions = {
  enforceAppSession?: boolean;
};

function getBearerToken(request: Request) {
  const header = request.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) return null;
  return header.slice("Bearer ".length);
}

export async function requireUser(request: Request, options: RequireUserOptions = {}): Promise<AuthContext | Response> {
  const shouldEnforceAppSession = options.enforceAppSession ?? true;
  const accessToken = getBearerToken(request);
  if (!accessToken) return fail("Missing bearer token", 401);

  const userClient = createSupabaseForToken(accessToken);
  const adminClient = createSupabaseAdmin();
  const { data: userData, error: userError } = await userClient.auth.getUser(accessToken);

  if (userError || !userData.user) {
    return fail("Invalid or expired session", 401);
  }

  const { data: profile, error: profileError } = await adminClient
    .from("profiles")
    .select("role,is_active")
    .eq("id", userData.user.id)
    .single();

  if (profileError || !profile?.is_active) {
    return fail("Profile not found or inactive", 403);
  }

  if (shouldEnforceAppSession) {
    const sessionError = await ensureActiveAppSession(adminClient, userData.user.id, request);
    if (sessionError) return sessionError;
  }

  return {
    userId: userData.user.id,
    accessToken,
    role: profile.role as AccordiaRole,
    userClient,
    adminClient
  };
}

export async function requireRole(request: Request, roles: AccordiaRole[]) {
  const auth = await requireUser(request);
  if (auth instanceof Response) return auth;
  if (!roles.includes(auth.role)) return fail("Forbidden for this role", 403);
  return auth;
}
