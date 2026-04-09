import { getZapiConfig } from "./config";
import { getSupabaseServer } from "./supabase-server";
import { sessionCache } from "./redis";

/** Build Z-API base URL and auth headers from config. */
export async function getZapiBase() {
  const config = await getZapiConfig();
  return buildZapiBase(config);
}

/** Build Z-API base URL and auth headers from a specific config. */
export function buildZapiBase(config: { instance_id: string; token: string; client_token?: string }) {
  const baseUrl = `https://api.z-api.io/instances/${config.instance_id}/token/${config.token}`;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (config.client_token) headers["Client-Token"] = config.client_token;
  return { baseUrl, headers, config };
}

/**
 * Get Z-API instance client for a specific tenant.
 * Checks cache first, then Supabase.
 */
export async function getZapiInstanceClient(instanceId: string) {
  // 1. Try Redis cache
  const cachedToken = await sessionCache.get(instanceId);
  if (cachedToken) {
    // For simplicity, we still fetch from DB to ensure client_token is current.
  }

  // 2. Fetch from Supabase instances table
  const supabase = getSupabaseServer();
  const { data, error } = await supabase
    .from("instances")
    .select("token, client_token")
    .eq("instance_id", instanceId)
    .maybeSingle();

  if (error || !data) {
    throw new Error(`Instance ${instanceId} not found or error fetching: ${error?.message}`);
  }

  // Cache the token for next time
  await sessionCache.set(instanceId, data.token);

  return buildZapiBase({
    instance_id: instanceId,
    token: data.token,
    client_token: data.client_token,
  });
}

export async function sendMessage(phone: string, text: string): Promise<void> {
  const { baseUrl, headers } = await getZapiBase();

  const response = await fetch(`${baseUrl}/send-text`, {
    method: "POST",
    headers,
    body: JSON.stringify({ phone, message: text }),
  });

  if (!response.ok) {
    const body = await response.text();
    console.error(`Z-API send failed (${response.status}):`, body);
  }
}
