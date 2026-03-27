import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { getZapiConfig } from "@/lib/config";
import { filterMessage, type ZapiPayload } from "@/lib/filters";
import { enqueueJob, dequeueJob, isProcessing, setProcessing, type TranscribeJob } from "@/lib/queue";
import { transcribeAudio, summarizeText } from "@/lib/openai";
import { sendMessage } from "@/lib/zapi";

export const maxDuration = 60;

const AUDIO_THRESHOLD_SECONDS = 40;
const SIGNATURE = "\n\n_Transcrição por IA by Andre 😜_";

async function processJob(job: TranscribeJob) {
  console.log(`[worker] Processing messageId=${job.messageId}`);

  const audioResponse = await fetch(job.audioUrl);
  if (!audioResponse.ok) {
    console.error(`[worker] Audio download failed: ${audioResponse.status}`);
    return;
  }
  const audioBuffer = Buffer.from(await audioResponse.arrayBuffer());

  const transcription = await transcribeAudio(audioBuffer);
  if (!transcription) {
    console.error("[worker] Empty transcription");
    return;
  }

  let message: string;
  if (job.seconds >= AUDIO_THRESHOLD_SECONDS) {
    const summary = await summarizeText(transcription);
    message = `*Resumo:*\n${summary}\n\n*Original:*\n${transcription}${SIGNATURE}`;
  } else {
    message = `${transcription}${SIGNATURE}`;
  }

  await sendMessage(job.phoneOrLid, message);
  console.log(`[worker] Done messageId=${job.messageId}`);
}

async function processQueue() {
  if (await isProcessing()) return;
  await setProcessing(true);

  try {
    for (let i = 0; i < 5; i++) {
      const job = await dequeueJob();
      if (!job) break;
      try {
        await processJob(job);
      } catch (error) {
        console.error(`[worker] Job failed:`, error instanceof Error ? error.message : error);
      }
    }
  } finally {
    await setProcessing(false);
  }
}

export async function POST(request: NextRequest) {
  try {
    // Auth check
    const config = await getZapiConfig();
    if (config.webhook_token) {
      const token = request.headers.get("x-token");
      if (token !== config.webhook_token) {
        return NextResponse.json({ error: "unauthorized" }, { status: 401 });
      }
    }

    const rawPayload = await request.json();
    const payload: ZapiPayload = rawPayload;

    const messageId = ("messageId" in rawPayload ? rawPayload.messageId : rawPayload.body?.messageId) as string | undefined;
    if (!messageId) {
      return NextResponse.json({ status: "skipped", reason: "no messageId" });
    }

    // Filter
    const result = await filterMessage(payload);
    if (result.action === "skip") {
      console.log(`Skipped: ${result.reason}`);
      return NextResponse.json({ status: "skipped", reason: result.reason });
    }

    // Enqueue (Redis handles dedup)
    const enqueued = await enqueueJob({
      audioUrl: result.audioUrl,
      seconds: result.seconds,
      phoneOrLid: result.phoneOrLid,
      messageId,
      enqueuedAt: Date.now(),
    });

    if (!enqueued) {
      return NextResponse.json({ status: "duplicate" });
    }

    console.log(`Queued: messageId=${messageId}`);

    // Process queue in background after response is sent
    after(processQueue);

    return NextResponse.json({ status: "queued" });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("Transcribe route error:", msg);
    return NextResponse.json({ status: "ok" });
  }
}
