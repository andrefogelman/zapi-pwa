import { NextRequest, NextResponse } from "next/server";
import { fetchMessages } from "@/lib/wacli-api";

export async function GET(request: NextRequest) {
  try {
    const chat = request.nextUrl.searchParams.get("chat");
    if (!chat) return NextResponse.json({ error: "chat required" }, { status: 400 });

    const limit = request.nextUrl.searchParams.get("limit") || "50";
    const after = request.nextUrl.searchParams.get("after") || undefined;

    const data = await fetchMessages({ chat, limit: Number(limit), after });
    return NextResponse.json(data);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
