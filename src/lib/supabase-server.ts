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
  const noAuth: GroupAuth = { authorized: false, transcribe_all: false, monitor_daily: false };

  // Try by group_id first
  const { data, error } = await supabase
    .from("grupos_autorizados")
    .select("group_id, transcribe_all, monitor_daily")
    .eq("group_id", groupId)
    .maybeSingle();

  if (error) {
    console.error("Supabase lookup failed, denying access (fail closed):", error.message);
    return noAuth;
  }

  if (data) {
    return { authorized: true, transcribe_all: data.transcribe_all ?? false, monitor_daily: data.monitor_daily ?? false };
  }

  // Fallback: try by group_lid
  const { data: lidData, error: lidError } = await supabase
    .from("grupos_autorizados")
    .select("group_id, transcribe_all, monitor_daily")
    .eq("group_lid", groupId)
    .maybeSingle();

  if (lidError || !lidData) return noAuth;

  return { authorized: true, transcribe_all: lidData.transcribe_all ?? false, monitor_daily: lidData.monitor_daily ?? false };
}

export async function verifyInstanceOwnership(userId: string, instanceId: string): Promise<<booleanboolean> {
  const supabase = getSupabaseServer();
  const { data, error } = await supabase
    .from("instances")
    .select("user_id")
    .eq("instance_id", instanceId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    console.error("Error verifying instance ownership:", error.message);
    return false;
  }

  return !!data;
}
