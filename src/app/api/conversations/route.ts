import { NextRequest, NextResponse } from "next/server";
import { fetchChats } from "@/lib/wacli-api";

export async function GET(request: NextRequest) {
  try {
    const query = request.nextUrl.searchParams.get("query") || undefined;
    const limit = request.nextUrl.searchParams.get("limit");
    const data = await fetchChats(query, limit ? Number(limit) : 100);
    return NextResponse.json(data);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
