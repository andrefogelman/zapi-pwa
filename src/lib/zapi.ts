import { getZapiConfig } from "./config";

/** Build Z-API base URL and auth headers from config. */
export async function getZapiBase() {
  const config = await getZapiConfig();
  const baseUrl = `https://api.z-api.io/instances/${config.instance_id}/token/${config.token}`;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (config.client_token) headers["Client-Token"] = config.client_token;
  return { baseUrl, headers, config };
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
