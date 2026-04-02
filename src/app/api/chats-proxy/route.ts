import { NextRequest, NextResponse } from "next/server";
import { getZapiConfig } from "@/lib/config";

export async function GET(request: NextRequest) {
  try {
    const query = (request.nextUrl.searchParams.get("query") || "").toLowerCase();
    const config = await getZapiConfig();
    const baseUrl = `https://api.z-api.io/instances/${config.instance_id}/token/${config.token}`;
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (config.client_token) headers["Client-Token"] = config.client_token;

    // Use Z-API /groups which returns all groups with names
    const res = await fetch(`${baseUrl}/groups?page=1&pageSize=500`, { headers });
    if (!res.ok) {
      return NextResponse.json({ error: "zapi_error", message: `Z-API ${res.status}` }, { status: 502 });
    }

    const groups: Array<{ phone: string; name: string }> = await res.json();

    const chats = groups
      .map((g) => {
        // Normalize: "120363...-group" → "120363...@g.us", "551199...-1234" → "551199...-1234@g.us"
        const jid = g.phone.endsWith("-group")
          ? g.phone.replace("-group", "@g.us")
          : `${g.phone}@g.us`;
        return { jid, name: g.name || jid, isGroup: true };
      })
      .filter((c) => !query || c.name.toLowerCase().includes(query))
      .sort((a, b) => a.name.localeCompare(b.name));

    return NextResponse.json({ chats });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: "failed", message: msg }, { status: 502 });
  }
}
