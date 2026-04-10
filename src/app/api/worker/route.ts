import { NextRequest, NextResponse } from "next/server";
import { TranscriptionQueue, TranscriptionJob } from "@/lib/queue";
import { getZapiInstanceClient } from "@/lib/zapi";
import { transcribeAudio, summarizeText } from "@/lib/openai";
import { getSupabaseServer } from "@/lib/supabase-server";

export async function GET(req: NextRequest) {
  console.log("Transcription Worker heartbeat: Checking for jobs...");

  const job = await TranscriptionQueue.dequeue();

  if (!job) {
    return NextResponse.json({ message: "No jobs to process" }, { status: 200 });
  }

  try {
    console.log(`Processing job for message ${job.messageId} on instance ${job.instanceId}`);

    // 1. Get Z-API client for this specific instance
    const { baseUrl, headers } = await getZapiInstanceClient(job.instanceId);

    // 2. Download audio binary from Z-API
    // Z-API audio URLs are typically direct links to the file.
    const audioResponse = await fetch(job.audioUrl);
    if (!audioResponse.ok) {
      throw new Error(`Failed to download audio: ${audioResponse.statusText}`);
    }
    const audioBuffer = await audioResponse.arrayBuffer();
    const buffer = Buffer.from(audioBuffer);

    // 3. Transcribe via OpenAI Whisper
    console.log("Transcribing audio...");
    const transcriptionText = await transcribeAudio(buffer);

    // 4. Generate summary via LLM
    console.log("Generating summary...");
    const summary = await summarizeText(transcriptionText);

    // 5. Save results to Supabase
    const supabase = getSupabaseServer();

    // Insert into transcriptions table
    const { error: transcriptionError } = await supabase
      .from("transcriptions")
      .insert({
        message_id: job.messageId,
        instance_id: job.instanceId,
        user_id: job.userId,
        text: transcriptionText,
        summary: summary,
      });

    if (transcriptionError) {
      throw transcriptionError;
    }

    // Update original message status
    const { error: updateError } = await supabase
      .from("messages")
      .update({ status: "transcribed" })
      .eq("id", job.messageId);

    if (updateError) {
      throw updateError;
    }

    console.log(`Successfully processed message ${job.messageId}`);
    return NextResponse.json({ message: "Job processed successfully" }, { status: 200 });

  } catch (error: any) {
    console.error(`Error processing job ${job.messageId}:`, error.message);

    // Optional: Re-enqueue the job or mark it as failed in the database
    // For now, we'll just log the error to avoid infinite loops on bad files.

    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
