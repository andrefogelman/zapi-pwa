import { getZapiConfig } from "./config";

export async function sendMessage(phone: string, text: string): Promise<void> {
  const config = await getZapiConfig();
  const url = `https://api.z-api.io/instances/${config.instance_id}/token/${config.token}/send-text`;

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (config.client_token) {
    headers["Client-Token"] = config.client_token;
  }

  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({ phone, message: text }),
  });

  if (!response.ok) {
    const body = await response.text();
    console.error(`Z-API send failed (${response.status}):`, body);
  }
}
