import { NextRequest, NextResponse } from "next/server";
import { getZapiConfig } from "@/lib/config";
import { filterMessage, type ZapiPayload } from "@/lib/filters";
import { enqueueJob } from "@/lib/queue";

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

    // Extract messageId
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

    // Trigger worker (fire and forget)
    const workerUrl = `https://${process.env.VERCEL_URL || "zapi-transcriber.vercel.app"}/api/worker`;
    fetch(workerUrl, { method: "POST" }).catch(() => {});

    return NextResponse.json({ status: "queued" });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("Transcribe route error:", msg);
    return NextResponse.json({ status: "ok" });
  }
}
