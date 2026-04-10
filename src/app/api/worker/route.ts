import { TranscriptionQueue } from "@/lib/queue";
import { transcribeAudio, summarizeText } from "@/lib/openai";
import { getSupabaseServer } from "@/lib/supabase-server";
import { circuitBreaker } from "@/lib/circuit-breaker";

export async function GET() {
  // Check circuit breaker
  if (await circuitBreaker.isOpen()) {
    return Response.json({ message: "Circuit breaker open, skipping" }, { status: 503 });
  }

  const job = await TranscriptionQueue.dequeue();
  if (!job) {
    return Response.json({ message: "No jobs" });
  }

  // Exponential backoff: skip if too soon
  const backoffMs = Math.pow(2, job.attempts) * 1000;
  if (job.attempts > 0 && Date.now() - job.createdAt < backoffMs) {
    await TranscriptionQueue.retry(job);
    return Response.json({ message: "Job backed off, re-queued" });
  }

  try {
    // 1. Download audio
    const audioResponse = await fetch(job.audioUrl);
    if (!audioResponse.ok) {
      await circuitBreaker.recordFailure();
      throw new Error(`Audio download failed: ${audioResponse.status}`);
    }

    await circuitBreaker.recordSuccess();
    const audioBuffer = await audioResponse.arrayBuffer();

    // 2. Transcribe
    const text = await transcribeAudio(audioBuffer);

    // 3. Summarize
    const summary = await summarizeText(text);

    // 4. Persist
    const supabase = getSupabaseServer();
    await supabase.from("transcriptions").insert({
      message_id: job.messageId,
      instance_id: job.instanceId,
      text,
      summary,
    });

    // 5. Update message status
    await supabase
      .from("messages")
      .update({ status: "transcribed" })
      .eq("id", job.messageId);

    return Response.json({ message: "Processed", jobId: job.id });

  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`Worker error (job ${job.id}, attempt ${job.attempts}):`, msg);
    await TranscriptionQueue.retry(job);
    return Response.json({ error: msg }, { status: 500 });
  }
}
