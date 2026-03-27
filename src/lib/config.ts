import { getSupabaseServer } from "./supabase-server";

export interface ZapiConfig {
  instance_id: string;
  token: string;
  client_token: string;
  webhook_token: string;
  connected_phone: string;
  my_phones: string[];
  my_lids: string[];
}

let cachedConfig: ZapiConfig | null = null;
let cacheTime = 0;
const CACHE_TTL_MS = 60_000; // 1 minute

export async function getZapiConfig(): Promise<ZapiConfig> {
  const now = Date.now();
  if (cachedConfig && now - cacheTime < CACHE_TTL_MS) {
    return cachedConfig;
  }

  const supabase = getSupabaseServer();
  const { data, error } = await supabase
    .from("zapi_config")
    .select("*")
    .limit(1)
    .single();

  if (error || !data) {
    throw new Error(`Failed to load zapi_config: ${error?.message ?? "no data"}`);
  }

  cachedConfig = {
    instance_id: data.instance_id,
    token: data.token,
    client_token: data.client_token ?? "",
    webhook_token: data.webhook_token,
    connected_phone: data.connected_phone,
    my_phones: data.my_phones ?? [],
    my_lids: data.my_lids ?? [],
  };
  cacheTime = now;

  return cachedConfig;
}
