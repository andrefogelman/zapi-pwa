import { NextRequest, NextResponse } from "next/server";
import { getZapiBase } from "@/lib/zapi";

export async function POST(request: NextRequest) {
  try {
    const { phone, messageId, reaction } = await request.json();
    if (!phone || !messageId) return NextResponse.json({ error: "phone and messageId required" }, { status: 400 });

    const { baseUrl, headers } = await getZapiBase();
    const res = await fetch(`${baseUrl}/send-reaction`, {
      method: "POST",
      headers,
      body: JSON.stringify({ phone, messageId, reaction: reaction || "" }),
    });

    const result = await res.json();
    if (!res.ok) return NextResponse.json({ error: result.error || "react failed" }, { status: 500 });
    return NextResponse.json({ status: "ok" });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
