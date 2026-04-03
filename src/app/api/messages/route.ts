import { NextRequest, NextResponse } from "next/server";
import { fetchMessages } from "@/lib/wacli-api";

export async function GET(request: NextRequest) {
  try {
    const chat = request.nextUrl.searchParams.get("chat");
    if (!chat) return NextResponse.json({ error: "chat required" }, { status: 400 });

    const limit = request.nextUrl.searchParams.get("limit") || "50";
    const after = request.nextUrl.searchParams.get("after") || undefined;

    console.log(`[messages] fetching chat=${chat} limit=${limit} url=${process.env.WACLI_API_URL}`);
    const data = await fetchMessages({ chat, limit: Number(limit), after });
    console.log(`[messages] got ${data.total} messages`);
    return NextResponse.json(data);
  } catch (error) {
    const msg = error instanceof Error ? `${error.message} | cause: ${error.cause}` : String(error);
    console.error(`[messages] error:`, msg);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
