import { redis } from './redis'

export interface TranscriptionJob {
  instanceId: string
  messageId: string
  audioUrl: string
  userId: string
  timestamp: number
}

export class TranscriptionQueue {
  private static readonly QUEUE_KEY = 'transcription_queue'

  /**
   * Enqueues a transcription job.
   */
  static async enqueue(job: TranscriptionJob): Promise<<voidvoid> {
    await redis.lpush(this.QUEUE_KEY, job)
  }

  /**
   * Dequeues the next transcription job.
   * Returns null if the queue is empty.
   */
  static async dequeue(): Promise<<TranscriptionTranscriptionJob | null> {
    const job = await redis.rpop(this.QUEUE_KEY)
    return (job as TranscriptionJob) || null
  }

  /**
   * Returns the current number of jobs in the queue.
   */
  static async getLength(): Promise<<numbernumber> {
    return await redis.llen(this.QUEUE_KEY)
  }
}
