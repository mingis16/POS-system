import "server-only";
import { createClient } from "@supabase/supabase-js";

/**
 * Service-role client. Bypasses row level security, so it is only used for
 * (1) creating staff logins after the caller is checked to be an admin, and
 * (2) the cron jobs, which authenticate with CRON_SECRET.
 * Returns null when SUPABASE_SERVICE_ROLE_KEY is not set.
 */
export function createAdminClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key || !process.env.NEXT_PUBLIC_SUPABASE_URL) return null;
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function canCreateAccounts(): boolean {
  return Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);
}
