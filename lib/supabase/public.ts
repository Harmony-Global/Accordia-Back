import { createClient } from "@supabase/supabase-js";
import { env } from "@/lib/env";

export function createSupabasePublic() {
  return createClient(env.supabaseUrl, env.supabaseAnonKey, {
    auth: {
      autoRefreshToken: false,
      flowType: "implicit",
      persistSession: false
    }
  });
}
