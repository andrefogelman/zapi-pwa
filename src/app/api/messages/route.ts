import { NextRequest, NextResponse } from "next/server";
import { fetchMessages } from "@/lib/wacli-api";

export async function GET(request: NextRequest) {
  try {
    const chat = request.nextUrl.searchParams.get("chat");
    if (!chat) return NextResponse.json({ error: "chat required" }, { status: 400 });

    const limit = request.nextUrl.searchParams.get("limit") || "100";
    const phone = request.nextUrl.searchParams.get("phone") || "";
    const after = request.nextUrl.searchParams.get("after") || undefined;

    // Try with provided JID
    let data = await fetchMessages({ chat, limit: Number(limit), after });

    // Fallback: try with phone@s.whatsapp.net
    if ((!data.messages || data.messages.length === 0) && phone) {
      const phoneData = await fetchMessages({ chat: `${phone}@s.whatsapp.net`, limit: Number(limit), after });
      if (phoneData.messages?.length > 0) data = phoneData;
    }

    return NextResponse.json(data);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
