import {
  getSupabaseServer,
  getSupabaseServiceRole,
  getUserFromToken,
} from "./supabase-server";
import { createClient, type User, type SupabaseClient } from "@supabase/supabase-js";

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/**
 * Validates that the request comes from an active super-admin.
 * Throws HttpError with 401 or 403 otherwise.
 *
 * Returns three things:
 *   - user: the authenticated super-admin
 *   - supabaseUser: a client scoped to the caller's JWT. RLS applies.
 *     auth.uid() returns user.id inside this client. Use this for
 *     admin_update_user_role / admin_update_user_status RPC calls and
 *     any SQL that needs auth.uid() in triggers.
 *   - supabaseAdmin: a service-role client. Bypasses RLS. Use for
 *     supabase.auth.admin.* operations (invite, delete, generateLink,
 *     updateUserById) and any SQL that needs to see data across
 *     users without going through RLS.
 */
export async function requireSuperAdmin(request: Request): Promise<{
  user: User;
  supabaseUser: SupabaseClient;
  supabaseAdmin: SupabaseClient;
}> {
  // Accept "Bearer" or "bearer" (some clients lowercase the scheme).
  const token = request.headers.get("Authorization")?.replace(/^[Bb]earer\s+/, "");
  if (!token) throw new HttpError(401, "unauthorized");

  const user = await getUserFromToken(token);
  if (!user) throw new HttpError(401, "unauthorized");

  const supabase = getSupabaseServer();
  const { data: settings, error } = await supabase
    .from("user_settings")
    .select("role, status")
    .eq("user_id", user.id)
    .single();

  if (error || !settings) throw new HttpError(403, "forbidden");
  if (settings.role !== "super_admin" || settings.status !== "active") {
    throw new HttpError(403, "forbidden");
  }

  // Build a user-scoped client from the Bearer token.
  // PostgREST will see auth.uid() == user.id when this client runs queries.
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error("SUPABASE_URL or SUPABASE_ANON_KEY not set");
  }
  const supabaseUser = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  return {
    user,
    supabaseUser,
    supabaseAdmin: getSupabaseServiceRole(),
  };
}

/**
 * Helper to convert HttpError into Response in catch blocks.
 * Returns JSON error with the appropriate status.
 */
export function errorResponse(err: unknown): Response {
  if (err instanceof HttpError) {
    return Response.json({ error: err.message }, { status: err.status });
  }
  console.error("unexpected error in admin route:", err);
  return Response.json({ error: "internal" }, { status: 500 });
}
