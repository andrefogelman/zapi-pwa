import { Redis } from "@upstash/redis";

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

const QUEUE_KEY = "transcribe:queue";
const PROCESSING_KEY = "transcribe:processing";
const DEDUP_PREFIX = "transcribe:seen:";
const DEDUP_TTL_SECONDS = 3600; // 1 hour

export interface TranscribeJob {
  audioUrl: string;
  seconds: number;
  phoneOrLid: string;
  messageId: string;
  enqueuedAt: number;
}

export async function enqueueJob(job: TranscribeJob): Promise<boolean> {
  // Dedup check
  const dedupKey = `${DEDUP_PREFIX}${job.messageId}`;
  const alreadySeen = await redis.set(dedupKey, "1", { nx: true, ex: DEDUP_TTL_SECONDS });
  if (!alreadySeen) {
    return false; // duplicate
  }

  await redis.lpush(QUEUE_KEY, JSON.stringify(job));
  return true;
}

export async function dequeueJob(): Promise<TranscribeJob | null> {
  const raw = await redis.rpop(QUEUE_KEY);
  if (!raw) return null;
  return JSON.parse(raw as string) as TranscribeJob;
}

export async function getQueueLength(): Promise<number> {
  return await redis.llen(QUEUE_KEY);
}

export async function isProcessing(): Promise<boolean> {
  const val = await redis.get(PROCESSING_KEY);
  return val === "1";
}

export async function setProcessing(active: boolean): Promise<void> {
  if (active) {
    // Auto-expire after 120s as safety net (in case worker crashes)
    await redis.set(PROCESSING_KEY, "1", { ex: 120 });
  } else {
    await redis.del(PROCESSING_KEY);
  }
}
