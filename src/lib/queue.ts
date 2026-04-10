import { redis } from "./redis";

export interface TranscriptionJob {
  instanceId: string;
  messageId: string;
  audioUrl: string;
  userId: string;
  timestamp: number;
}

export class TranscriptionQueue {
  private static readonly QUEUE_KEY = "transcription_queue";

  static async enqueue(job: TranscriptionJob): Promise<<voidvoid> {
    await redis.lpush(this.QUEUE_KEY, JSON.stringify(job));
  }

  static async dequeue(): Promise<<TranscriptionTranscriptionJob | null> {
    const job = await redis.rpop(this.QUEUE_KEY);
    if (!job) return null;
    try {
      return JSON.parse(job) as TranscriptionJob;
    } catch (e) {
      console.error("Failed to parse job from queue:", e);
      return null;
    }
  }

  static async getLength(): Promise<<numbernumber> {
    return await redis.llen(this.QUEUE_KEY);
  }
}
