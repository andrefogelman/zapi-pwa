import { NextRequest, NextResponse } from "next/server";
import { env } from "@/lib/env";

export async function GET(request: NextRequest) {
  const chat = request.nextUrl.searchParams.get("chat");
  const id = request.nextUrl.searchParams.get("id");

  if (!chat || !id) {
    return NextResponse.json({ error: "chat and id required" }, { status: 400 });
  }

  try {
    const res = await fetch(
      `${env.WACLI_API_URL}/media?chat=${encodeURIComponent(chat)}&id=${encodeURIComponent(id)}`,
      { headers: { Authorization: `Bearer ${env.WACLI_API_TOKEN}` } }
    );

    if (!res.ok) {
      return NextResponse.json({ error: "media not found" }, { status: 404 });
    }

    const contentType = res.headers.get("content-type") || "application/octet-stream";
    const buffer = await res.arrayBuffer();

    return new NextResponse(buffer, {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=86400",
      },
    });
  } catch (error) {
    return NextResponse.json({ error: "fetch failed" }, { status: 502 });
  }
}
