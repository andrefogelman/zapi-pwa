import { NextRequest, NextResponse } from "next/server";
import { fetchMessages } from "@/lib/wacli-api";

export async function GET(request: NextRequest) {
  try {
    const chat = request.nextUrl.searchParams.get("chat");
    if (!chat) return NextResponse.json({ error: "chat required" }, { status: 400 });

    const limit = request.nextUrl.searchParams.get("limit") || "500";
    const phone = request.nextUrl.searchParams.get("phone") || "";
    const after = request.nextUrl.searchParams.get("after") || undefined;

    console.log(`[messages] chat=${chat} phone=${phone} limit=${limit} after=${after}`);

    // Try with provided JID
    let data = await fetchMessages({ chat, limit: Number(limit), after });

    console.log(`[messages] JID result: ${data.messages?.length ?? 0} msgs, total=${data.total}`);
    if (data.messages?.length > 0) {
      const first = data.messages[0];
      const last = data.messages[data.messages.length - 1];
      console.log(`[messages] first: ${first.timestamp} | last: ${last.timestamp}`);
    }

    // Fallback: try with phone@s.whatsapp.net
    if ((!data.messages || data.messages.length === 0) && phone) {
      console.log(`[messages] fallback to phone: ${phone}@s.whatsapp.net`);
      const phoneData = await fetchMessages({ chat: `${phone}@s.whatsapp.net`, limit: Number(limit), after });
      console.log(`[messages] fallback result: ${phoneData.messages?.length ?? 0} msgs`);
      if (phoneData.messages?.length > 0) data = phoneData;
    }

    return NextResponse.json(data, {
      headers: { "Cache-Control": "no-store, no-cache, must-revalidate" },
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
