import { NextRequest, NextResponse } from "next/server";
import { getZapiConfig } from "@/lib/config";

export async function GET(request: NextRequest) {
  try {
    const query = (request.nextUrl.searchParams.get("query") || "").toLowerCase();
    const limit = Number(request.nextUrl.searchParams.get("limit") || "200");

    const config = await getZapiConfig();
    const baseUrl = `https://api.z-api.io/instances/${config.instance_id}/token/${config.token}`;
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (config.client_token) headers["Client-Token"] = config.client_token;

    // Fetch all chats from Z-API (DMs + groups)
    const res = await fetch(`${baseUrl}/chats?page=1&pageSize=${limit}`, { headers });
    if (!res.ok) {
      return NextResponse.json({ error: `Z-API ${res.status}` }, { status: 502 });
    }

    const rawChats: Array<{
      phone: string;
      name: string;
      lid?: string;
      isGroup: boolean;
      lastMessageTime?: string;
      unread?: string;
    }> = await res.json();

    const chats = rawChats
      .map((c) => {
        // Build JID
        let jid: string;
        if (c.isGroup) {
          jid = c.phone.endsWith("-group")
            ? c.phone.replace("-group", "@g.us")
            : c.phone.includes("@") ? c.phone : `${c.phone}@g.us`;
        } else {
          // DM: prefer LID if available, else phone@s.whatsapp.net
          jid = c.lid || `${c.phone}@s.whatsapp.net`;
        }

        return {
          jid,
          phone: c.phone,
          lid: c.lid || null,
          name: c.name || c.phone,
          isGroup: c.isGroup,
          lastMessageTime: c.lastMessageTime ? Number(c.lastMessageTime) : 0,
          unread: Number(c.unread || 0),
        };
      })
      .filter((c) => !query || c.name.toLowerCase().includes(query))
      .sort((a, b) => b.lastMessageTime - a.lastMessageTime); // Most recent first

    return NextResponse.json({ chats });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
