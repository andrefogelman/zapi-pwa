import { createClient } from "@supabase/supabase-js";
import { env } from "./env";

export function getSupabaseServer() {
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
}

export async function isGroupAuthorized(groupId: string): Promise<boolean> {
  const supabase = getSupabaseServer();
  const { data, error } = await supabase
    .from("grupos_autorizados")
    .select("group_id")
    .eq("group_id", groupId)
    .maybeSingle();

  if (error) {
    console.error("Supabase lookup failed, denying access (fail closed):", error.message);
    return false;
  }

  return !!data;
}
