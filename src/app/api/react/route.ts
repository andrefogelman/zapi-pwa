import { NextRequest, NextResponse } from "next/server";
import { getZapiConfig } from "@/lib/config";

export async function POST(request: NextRequest) {
  try {
    const { phone, messageId, reaction } = await request.json();
    if (!phone || !messageId) return NextResponse.json({ error: "phone and messageId required" }, { status: 400 });

    const config = await getZapiConfig();
    const url = `https://api.z-api.io/instances/${config.instance_id}/token/${config.token}/send-reaction`;
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (config.client_token) headers["Client-Token"] = config.client_token;

    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({ phone, messageId, reaction: reaction || "" }),
    });

    const result = await res.json();
    if (!res.ok) return NextResponse.json({ error: result.error || "react failed" }, { status: 500 });
    return NextResponse.json({ status: "ok" });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
