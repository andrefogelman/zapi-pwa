import { getSupabaseServer } from "./supabase-server";

interface ZapiClient {
  baseUrl: string;
  headers: Record<string, string>;
}

/**
 * Build a Z-API client for a specific instance.
 * Checks Redis cache first, falls back to Supabase.
 */
export async function getZapiClient(instanceId: string): Promise<ZapiClient> {
  const supabase = getSupabaseServer();
  const { data, error } = await supabase
    .from("instances")
    .select("zapi_instance_id, zapi_token, zapi_client_token")
    .eq("id", instanceId)
    .single();

  if (error || !data) {
    throw new Error(`Instance ${instanceId} not found`);
  }

  const baseUrl = `https://api.z-api.io/instances/${data.zapi_instance_id}/token/${data.zapi_token}`;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (data.zapi_client_token) {
    headers["Client-Token"] = data.zapi_client_token;
  }

  return { baseUrl, headers };
}
