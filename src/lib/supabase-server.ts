import { createClient } from "@supabase/supabase-js";
import { env } from "./env";

export function getSupabaseServer() {
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
}

export async function isGroupAuthorized(groupId: string): Promise<boolean> {
  const supabase = getSupabaseServer();

  // Check by group_id (JID) or group_lid (LID)
  const { data, error } = await supabase
    .from("grupos_autorizados")
    .select("group_id")
    .or(`group_id.eq.${groupId},group_lid.eq.${groupId}`)
    .maybeSingle();

  if (error) {
    console.error("Supabase lookup failed, denying access (fail closed):", error.message);
    return false;
  }

  return !!data;
}
