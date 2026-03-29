import { createClient } from "@supabase/supabase-js";
import { env } from "./env";

export function getSupabaseServer() {
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
}

export interface GroupAuth {
  authorized: boolean;
  transcribe_all: boolean;
  monitor_daily: boolean;
}

export async function getGroupAuth(groupId: string): Promise<GroupAuth> {
  const supabase = getSupabaseServer();

  const { data, error } = await supabase
    .from("grupos_autorizados")
    .select("group_id, transcribe_all, monitor_daily")
    .or(`group_id.eq.${groupId},group_lid.eq.${groupId}`)
    .maybeSingle();

  if (error) {
    console.error("Supabase lookup failed, denying access (fail closed):", error.message);
    return { authorized: false, transcribe_all: false, monitor_daily: false };
  }

  if (!data) {
    return { authorized: false, transcribe_all: false, monitor_daily: false };
  }

  return {
    authorized: true,
    transcribe_all: data.transcribe_all ?? false,
    monitor_daily: data.monitor_daily ?? false,
  };
}
