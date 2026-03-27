import { NextResponse } from "next/server";
import { dequeueJob, setProcessing, isProcessing, getQueueLength } from "@/lib/queue";
import { transcribeAudio, summarizeText } from "@/lib/openai";
import { sendMessage } from "@/lib/zapi";

export const maxDuration = 60;

const AUDIO_THRESHOLD_SECONDS = 40;
const SIGNATURE = "\n\n_Transcrição por IA by Andre 😜_";

export async function POST() {
  // Prevent concurrent workers
  if (await isProcessing()) {
    return NextResponse.json({ status: "already_processing" });
  }

  await setProcessing(true);
  let processed = 0;

  try {
    // Process up to 5 jobs per invocation (stay within timeout)
    for (let i = 0; i < 5; i++) {
      const job = await dequeueJob();
      if (!job) break;

      try {
        console.log(`[worker] Processing messageId=${job.messageId} phone=${job.phoneOrLid}`);

        // Download audio
        const audioResponse = await fetch(job.audioUrl);
        if (!audioResponse.ok) {
          console.error(`[worker] Audio download failed: ${audioResponse.status}`);
          continue;
        }
        const audioBuffer = Buffer.from(await audioResponse.arrayBuffer());

        // Transcribe
        const transcription = await transcribeAudio(audioBuffer);
        if (!transcription) {
          console.error("[worker] Empty transcription");
          continue;
        }

        // Build message
        let message: string;
        if (job.seconds >= AUDIO_THRESHOLD_SECONDS) {
          const summary = await summarizeText(transcription);
          message = `*Resumo:*\n${summary}\n\n*Original:*\n${transcription}${SIGNATURE}`;
        } else {
          message = `${transcription}${SIGNATURE}`;
        }

        // Send via Z-API
        await sendMessage(job.phoneOrLid, message);
        processed++;
        console.log(`[worker] Done messageId=${job.messageId}`);
      } catch (error) {
        console.error(`[worker] Job failed:`, error instanceof Error ? error.message : error);
      }
    }
  } finally {
    await setProcessing(false);
  }

  const remaining = await getQueueLength();

  // If more jobs remain, trigger another worker invocation
  if (remaining > 0) {
    const host = process.env.VERCEL_URL || "zapi-transcriber.vercel.app";
    fetch(`https://${host}/api/worker`, { method: "POST" }).catch(() => {});
  }

  return NextResponse.json({ status: "ok", processed, remaining });
}

// GET handler for Vercel Cron (safety net)
export async function GET() {
  const length = await getQueueLength();
  if (length === 0) {
    return NextResponse.json({ status: "empty", queue: 0 });
  }
  // Trigger processing via POST
  return POST();
}
