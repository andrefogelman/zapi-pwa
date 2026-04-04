import { NextRequest, NextResponse } from "next/server";
import { transcribeAudio } from "@/lib/openai";
import { env } from "@/lib/env";

export const maxDuration = 60;

export async function POST(request: NextRequest) {
  try {
    const { mediaUrl, chat, msgId } = await request.json();

    let audioBuffer: Buffer;

    if (mediaUrl) {
      // Direct URL provided
      const res = await fetch(mediaUrl);
      if (!res.ok) return NextResponse.json({ error: "download failed" }, { status: 502 });
      audioBuffer = Buffer.from(await res.arrayBuffer());
    } else if (chat && msgId) {
      // Fetch from wacli-api media endpoint
      const res = await fetch(`${env.WACLI_API_URL}/media?chat=${encodeURIComponent(chat)}&id=${encodeURIComponent(msgId)}`, {
        headers: { Authorization: `Bearer ${env.WACLI_API_TOKEN}` },
      });
      if (!res.ok) return NextResponse.json({ error: "media download failed" }, { status: 502 });
      audioBuffer = Buffer.from(await res.arrayBuffer());
    } else {
      return NextResponse.json({ error: "mediaUrl or chat+msgId required" }, { status: 400 });
    }

    const text = await transcribeAudio(audioBuffer);
    return NextResponse.json({ text: text || "" });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
