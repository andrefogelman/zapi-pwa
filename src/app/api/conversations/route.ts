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

    const res = await fetch(`${baseUrl}/chats?page=1&pageSize=${limit}`, { headers, cache: "no-store" });
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
      pinned?: string;
      isMuted?: string;
      archived?: string;
      communityId?: string;
    }> = await res.json();

    const chats = rawChats
      .filter((c) => {
        if (c.phone?.includes("newsletter")) return false;
        if (c.communityId) return false;
        if (c.archived === "true") return false;
        return true;
      })
      .map((c) => {
        let jid: string;
        if (c.isGroup) {
          jid = c.phone.endsWith("-group")
            ? c.phone.replace("-group", "@g.us")
            : c.phone.includes("@") ? c.phone : `${c.phone}@g.us`;
        } else {
          jid = c.lid || `${c.phone}@s.whatsapp.net`;
        }

        const ts = c.lastMessageTime ? Number(c.lastMessageTime) : 0;
        let timeLabel = "";
        if (ts > 0) {
          const d = new Date(ts);
          const now = new Date();
          const diffDays = Math.floor((now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24));
          if (diffDays === 0) {
            timeLabel = d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });
          } else if (diffDays === 1) {
            timeLabel = "Ontem";
          } else if (diffDays < 7) {
            timeLabel = d.toLocaleDateString("pt-BR", { weekday: "short", timeZone: "America/Sao_Paulo" });
          } else {
            timeLabel = d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", timeZone: "America/Sao_Paulo" });
          }
        }

        return {
          jid,
          phone: c.phone,
          lid: c.lid || null,
          name: (c.name && c.name.trim()) || c.phone || c.lid || "Desconhecido",
          isGroup: c.isGroup,
          lastMessageTime: ts,
          timeLabel,
          unread: Number(c.unread || 0),
          pinned: c.pinned === "true",
          muted: c.isMuted === "1",
          photo: null as string | null,
          lastMessage: null as { text: string; sender: string; fromMe: boolean; type: string } | null,
        };
      })
      .filter((c) => !query || c.name.toLowerCase().includes(query))
      .sort((a, b) => {
        if (a.pinned && !b.pinned) return -1;
        if (!a.pinned && b.pinned) return 1;
        return b.lastMessageTime - a.lastMessageTime;
      });

    return NextResponse.json({ chats });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
