import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getEnv } from "@/lib/env";

// Server-side Supabase client. ALWAYS uses the service-role key — never expose
// the resulting client (or the env var) to the browser. We also make a separate
// "anon" server client for cases where we explicitly want RLS to apply.

let serviceClient: SupabaseClient | null = null;

export function getServerSupabase(): SupabaseClient {
  if (serviceClient) return serviceClient;
  const env = getEnv();
  if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error(
      "Supabase not configured. Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY."
    );
  }
  serviceClient = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return serviceClient;
}

export function isSupabaseConfigured(): boolean {
  const env = getEnv();
  return Boolean(env.NEXT_PUBLIC_SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY);
}
