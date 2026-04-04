import { NextRequest, NextResponse } from "next/server";
import { getZapiConfig } from "@/lib/config";

export async function POST(request: NextRequest) {
  try {
    const { recipient, contactName, contactPhone } = await request.json();
    if (!recipient || !contactName || !contactPhone) {
      return NextResponse.json({ error: "recipient, contactName, contactPhone required" }, { status: 400 });
    }

    const config = await getZapiConfig();
    const url = `https://api.z-api.io/instances/${config.instance_id}/token/${config.token}/send-contact`;
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (config.client_token) headers["Client-Token"] = config.client_token;

    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({ phone: recipient, contactName, contactPhone }),
    });

    const result = await res.json();
    if (!res.ok) return NextResponse.json({ error: result.error || "send failed" }, { status: 500 });

    return NextResponse.json({ status: "sent", messageId: result.messageId || result.id });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
