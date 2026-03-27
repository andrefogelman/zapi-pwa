import { NextRequest, NextResponse } from "next/server";
import { getZapiConfig } from "@/lib/config";
import { filterMessage, type ZapiPayload } from "@/lib/filters";
import { transcribeAudio, summarizeText } from "@/lib/openai";
import { sendMessage } from "@/lib/zapi";

export const maxDuration = 60;

const AUDIO_THRESHOLD_SECONDS = 40;
const SIGNATURE = "\n\n_Transcrição por IA by Andre 😜_";

// Simple deduplication: LRU of last 100 messageIds
// Note: on Vercel serverless, this Set resets per cold start. It helps within
// a warm instance but won't catch duplicates across different isolates.
const recentMessages = new Set<string>();
const MAX_RECENT = 100;

function isDuplicate(messageId: string): boolean {
  if (recentMessages.has(messageId)) return true;
  recentMessages.add(messageId);
  if (recentMessages.size > MAX_RECENT) {
    const first = recentMessages.values().next().value;
    if (first) recentMessages.delete(first);
  }
  return false;
}

export async function POST(request: NextRequest) {
  try {
    // Auth check — webhook_token from Supabase config
    const config = await getZapiConfig();
    const token = request.headers.get("x-token");
    if (token !== config.webhook_token) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    const payload: ZapiPayload = await request.json();

    // Dedup check
    if (isDuplicate(payload.body.messageId)) {
      return NextResponse.json({ status: "duplicate" });
    }

    // Filter
    const result = await filterMessage(payload);
    if (result.action === "skip") {
      console.log(`Skipped: ${result.reason}`);
      return NextResponse.json({ status: "skipped", reason: result.reason });
    }

    // Download audio
    const audioResponse = await fetch(result.audioUrl);
    if (!audioResponse.ok) {
      console.error(`Audio download failed: ${audioResponse.status}`);
      return NextResponse.json({ status: "ok" });
    }
    const audioBuffer = Buffer.from(await audioResponse.arrayBuffer());

    // Transcribe
    const transcription = await transcribeAudio(audioBuffer);
    if (!transcription) {
      console.error("Empty transcription");
      return NextResponse.json({ status: "ok" });
    }

    // Build message
    let message: string;
    if (result.seconds >= AUDIO_THRESHOLD_SECONDS) {
      const summary = await summarizeText(transcription);
      message = `*Resumo:*\n${summary}\n\n*Original:*\n${transcription}${SIGNATURE}`;
    } else {
      message = `${transcription}${SIGNATURE}`;
    }

    // Send via Z-API
    await sendMessage(result.phoneOrLid, message);

    return NextResponse.json({ status: "ok" });
  } catch (error) {
    console.error("Transcribe route error:", error);
    return NextResponse.json({ status: "ok" });
  }
}
