import { NextRequest, NextResponse } from "next/server";
import { fetchMessages } from "@/lib/wacli-api";

export async function GET(request: NextRequest) {
  try {
    const chat = request.nextUrl.searchParams.get("chat");
    if (!chat) return NextResponse.json({ error: "chat required" }, { status: 400 });

    const limit = request.nextUrl.searchParams.get("limit") || "50";
    const after = request.nextUrl.searchParams.get("after") || undefined;

    // Try with provided JID first
    let data = await fetchMessages({ chat, limit: Number(limit), after });

    // If no messages and chat is a LID, try with phone@s.whatsapp.net
    if (data.total === 0 || !data.messages?.length) {
      const phone = request.nextUrl.searchParams.get("phone");
      if (phone) {
        const phoneJid = `${phone}@s.whatsapp.net`;
        const phoneData = await fetchMessages({ chat: phoneJid, limit: Number(limit), after });
        if (phoneData.messages?.length > 0) data = phoneData;
      }
    }

    // If still no messages and chat is a LID, also try just the number part
    if (data.total === 0 || !data.messages?.length) {
      if (chat.includes("@lid")) {
        // Try searching wacli chats for this contact
        const altData = await fetchMessages({ chat, limit: Number(limit), after }).catch(() => null);
        if (altData && altData.messages?.length) data = altData;
      }
    }

    return NextResponse.json(data);
  } catch (error) {
    const msg = error instanceof Error ? `${error.message} | cause: ${error.cause}` : String(error);
    console.error(`[messages] error:`, msg);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
