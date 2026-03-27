import { getZapiConfig } from "./config";

export async function sendMessage(phone: string, text: string): Promise<void> {
  const config = await getZapiConfig();
  const url = `https://api.z-api.io/instances/${config.instance_id}/token/${config.token}/send-text`;

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phone, message: text }),
  });

  if (!response.ok) {
    const body = await response.text();
    console.error(`Z-API send failed (${response.status}):`, body);
  }
}
