import { NextRequest, NextResponse } from "next/server";
import { getZapiConfig } from "@/lib/config";
import { filterMessage, type ZapiPayload, type ZapiBody } from "@/lib/filters";
import { enqueueJob, dequeueJob, setProcessing, isProcessing } from "@/lib/queue";
import { transcribeAudio, summarizeText } from "@/lib/openai";
import { sendMessage } from "@/lib/zapi";
import { saveMonitoredMessage } from "@/lib/monitor";

export const maxDuration = 60;

const AUDIO_THRESHOLD_SECONDS = 40;
const SIGNATURE = "\n\n_Transcrição por IA by Andre 😜_";

function extractBody(payload: ZapiPayload): ZapiBody {
  if ("body" in payload && typeof payload.body === "object" && payload.body !== null && "phone" in payload.body) {
    return payload.body as ZapiBody;
  }
  return payload as ZapiBody;
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
    const body = extractBody(payload);

    const messageId = body.messageId;
    if (!messageId) {
      return NextResponse.json({ status: "skipped", reason: "no messageId" });
    }

    // Save text messages from monitored groups (before audio filter)
    if (body.isGroup && !body.fromMe) {
      const textContent = body.text?.message;
      if (textContent) {
        saveMonitoredMessage({
          groupId: body.phone,
          groupName: body.chatName || "",
          sender: body.participantPhone || body.phone,
          senderName: body.senderName || "Desconhecido",
          messageType: "text",
          content: textContent,
        }).catch(() => {}); // fire and forget
      }
    }

    // Filter for audio processing
    const result = await filterMessage(payload);
    if (result.action === "skip") {
      console.log(`Skipped: ${result.reason}`);
      return NextResponse.json({ status: "skipped", reason: result.reason });
    }

    // Enqueue audio job (Redis dedup)
    const enqueued = await enqueueJob({
      audioUrl: result.audioUrl,
      seconds: result.seconds,
      phoneOrLid: result.phoneOrLid,
      messageId,
      enqueuedAt: Date.now(),
      // Extra data for monitoring
      groupId: body.isGroup ? body.phone : undefined,
      groupName: body.chatName,
      senderName: body.senderName || "Desconhecido",
    });

    if (!enqueued) {
      return NextResponse.json({ status: "duplicate" });
    }

    console.log(`Queued: messageId=${messageId}`);

    // Process queue
    if (await isProcessing()) {
      return NextResponse.json({ status: "queued" });
    }

    await setProcessing(true);
    try {
      for (let i = 0; i < 5; i++) {
        const job = await dequeueJob();
        if (!job) break;

        try {
          console.log(`[worker] Processing messageId=${job.messageId}`);

          const audioResponse = await fetch(job.audioUrl);
          if (!audioResponse.ok) {
            console.error(`[worker] Audio download failed: ${audioResponse.status}`);
            continue;
          }
          const audioBuffer = Buffer.from(await audioResponse.arrayBuffer());

          const transcription = await transcribeAudio(audioBuffer);
          if (!transcription) {
            console.error("[worker] Empty transcription");
            continue;
          }

          // Save audio transcription to monitored messages
          if (job.groupId) {
            saveMonitoredMessage({
              groupId: job.groupId,
              groupName: job.groupName || "",
              sender: job.senderName || "Desconhecido",
              senderName: job.senderName || "Desconhecido",
              messageType: "audio_transcription",
              content: transcription,
            }).catch(() => {});
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
        } catch (error) {
          console.error(`[worker] Job failed:`, error instanceof Error ? error.message : error);
        }
      }
    } finally {
      await setProcessing(false);
    }

    return NextResponse.json({ status: "ok" });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("Transcribe route error:", msg);
    return NextResponse.json({ status: "ok" });
  }
}
