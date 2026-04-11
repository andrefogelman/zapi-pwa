import { createClient } from "@supabase/supabase-js";
import { env } from "./env";

export function getSupabaseServer() {
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
}

export async function getUserFromToken(token: string) {
  const supabase = getSupabaseServer();
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) return null;
  return user;
}

/**
 * Service-role client. Bypasses RLS. Never expose to browser code.
 * Use only in server-side routes that have already validated the caller.
 *
 * Note: under this client, auth.uid() is NULL. For SQL that depends on
 * auth.uid() (e.g. the admin_update_user_role RPC), use a user-scoped
 * client built from the caller's Bearer token instead.
 */
export function getSupabaseServiceRole() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set");
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
