import { redis } from "./redis";

export interface TranscriptionJob {
  id: string;
  instanceId: string;
  messageId: string;
  audioUrl: string;
  attempts: number;
  createdAt: number;
}

const QUEUE_KEY = "transcription:queue";
const DLQ_KEY = "transcription:dlq";
const MAX_ATTEMPTS = 3;

export const TranscriptionQueue = {
  async enqueue(job: Omit<TranscriptionJob, "id" | "attempts" | "createdAt">): Promise<string> {
    const id = crypto.randomUUID();
    const fullJob: TranscriptionJob = {
      ...job,
      id,
      attempts: 0,
      createdAt: Date.now(),
    };
    await redis.lpush(QUEUE_KEY, JSON.stringify(fullJob));
    return id;
  },

  async dequeue(): Promise<TranscriptionJob | null> {
    const raw = await redis.rpop(QUEUE_KEY);
    if (!raw) return null;
    try {
      return JSON.parse(raw as string) as TranscriptionJob;
    } catch {
      console.error("Failed to parse job from queue");
      return null;
    }
  },

  async retry(job: TranscriptionJob): Promise<void> {
    job.attempts += 1;
    if (job.attempts >= MAX_ATTEMPTS) {
      await redis.lpush(DLQ_KEY, JSON.stringify(job));
      console.error(`Job ${job.id} moved to DLQ after ${MAX_ATTEMPTS} attempts`);
      return;
    }
    await redis.lpush(QUEUE_KEY, JSON.stringify(job));
  },

  async getLength(): Promise<number> {
    return await redis.llen(QUEUE_KEY);
  },

  async getDLQLength(): Promise<number> {
    return await redis.llen(DLQ_KEY);
  },

  async peekDLQ(count = 10): Promise<TranscriptionJob[]> {
    const items = await redis.lrange(DLQ_KEY, 0, count - 1);
    return items.map((item) => JSON.parse(item as string) as TranscriptionJob);
  },
};
