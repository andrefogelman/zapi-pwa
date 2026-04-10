# Plan 2: Transcription Pipeline & Reliability

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the async transcription pipeline: Redis job queue, OpenAI Whisper worker, retry with exponential backoff, dead letter queue, and circuit breaker for Z-API outages.

**Architecture:** Producer-Consumer via Redis. Webhook inserts messages → queues audio jobs → Worker dequeues, transcribes, persists. Failed jobs retry with backoff up to 3 times, then move to DLQ.

**Tech Stack:** Upstash Redis (job queue + DLQ), OpenAI Whisper + GPT, Supabase (persistence), Next.js API routes.

**Depends on:** Plan 1 (database schema, Z-API client, Redis infra must exist).

---

## File Structure

```
src/lib/
├── queue.ts              # TranscriptionQueue: enqueue, dequeue, DLQ, retry logic
├── openai.ts             # Whisper transcription + GPT summarization
├── circuit-breaker.ts    # Circuit breaker for Z-API calls
src/app/api/
├── worker/route.ts       # GET: process next job (called by cron/external trigger)
└── webhook/route.ts      # MODIFY: enqueue audio jobs after message insertion
```

---

### Task 1: OpenAI Integration

**Files:**
- Create: `src/lib/openai.ts`

- [ ] **Step 1: Create `src/lib/openai.ts`**

```typescript
import OpenAI from "openai";
import { env } from "./env";

const openai = new OpenAI({ apiKey: env.OPENAI_API_KEY });

export async function transcribeAudio(audioBuffer: ArrayBuffer): Promise<string> {
  const blob = new Blob([audioBuffer], { type: "audio/ogg" });
  const file = new File([blob], "audio.ogg", { type: "audio/ogg" });

  const response = await openai.audio.transcriptions.create({
    model: "whisper-1",
    file,
  });

  return response.text;
}

export async function summarizeText(text: string): Promise<string> {
  const response = await openai.chat.completions.create({
    model: "gpt-4.1-mini",
    temperature: 0.3,
    messages: [
      {
        role: "system",
        content: "Você é um assistente que resume transcrições de áudio do WhatsApp. Resuma de forma concisa em português, mantendo os pontos principais.",
      },
      { role: "user", content: `Resuma este áudio transcrito:\n\n${text}` },
    ],
  });

  return response.choices[0]?.message?.content ?? "";
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/openai.ts
git commit -m "feat: add OpenAI Whisper transcription and GPT summarization"
```

---

### Task 2: Job Queue with Retry & DLQ

**Files:**
- Create: `src/lib/queue.ts`

- [ ] **Step 1: Create `src/lib/queue.ts`**

```typescript
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
    // Exponential backoff: re-enqueue with delay metadata
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
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/queue.ts
git commit -m "feat: add transcription queue with retry logic and DLQ"
```

---

### Task 3: Circuit Breaker

**Files:**
- Create: `src/lib/circuit-breaker.ts`

- [ ] **Step 1: Create `src/lib/circuit-breaker.ts`**

```typescript
import { redis } from "./redis";

const CIRCUIT_KEY = "circuit:zapi";
const FAILURE_THRESHOLD = 5;
const COOLDOWN_SECONDS = 300; // 5 minutes

export const circuitBreaker = {
  async isOpen(): Promise<boolean> {
    const state = await redis.get<string>(CIRCUIT_KEY);
    return state === "open";
  },

  async recordFailure(): Promise<void> {
    const key = `${CIRCUIT_KEY}:failures`;
    const count = await redis.incr(key);
    await redis.expire(key, 60); // failures expire after 1 minute

    if (count >= FAILURE_THRESHOLD) {
      await redis.set(CIRCUIT_KEY, "open", { ex: COOLDOWN_SECONDS });
      await redis.del(key);
      console.error("Circuit breaker OPEN: Z-API failures exceeded threshold");
    }
  },

  async recordSuccess(): Promise<void> {
    await redis.del(`${CIRCUIT_KEY}:failures`);
    await redis.del(CIRCUIT_KEY);
  },
};
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/circuit-breaker.ts
git commit -m "feat: add circuit breaker for Z-API calls"
```

---

### Task 4: Transcription Worker

**Files:**
- Create: `src/app/api/worker/route.ts`

- [ ] **Step 1: Create `src/app/api/worker/route.ts`**

```typescript
import { TranscriptionQueue } from "@/lib/queue";
import { getZapiClient } from "@/lib/zapi";
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
    // Put it back for later
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
```

- [ ] **Step 2: Commit**

```bash
git add src/app/api/worker/route.ts
git commit -m "feat: add transcription worker with circuit breaker and retry"
```

---

### Task 5: Wire Webhook to Queue

**Files:**
- Modify: `src/app/api/webhook/route.ts` (created in Plan 1, Task 8)

- [ ] **Step 1: Add queue enqueue after audio message insertion**

After the message insert block in the webhook handler, add:

```typescript
// At the top of the file, add import:
import { TranscriptionQueue } from "@/lib/queue";

// After successful message insert, if it's an audio message:
if ((type === "audio" || body.audio) && !error) {
  const audioUrl = body.audio?.audioUrl;
  if (audioUrl && data) {
    await TranscriptionQueue.enqueue({
      instanceId: instance.id,
      messageId: data[0]?.id || messageId,
      audioUrl,
    });
  }
}
```

The webhook route insert call needs `.select()` to return the inserted row ID. Modify the insert to:

```typescript
const { data, error } = await supabase.from("messages").insert({
  instance_id: instance.id,
  message_id: messageId || crypto.randomUUID(),
  chat_jid: chatId || phone || "unknown",
  sender: fromMe ? "me" : (phone || "unknown"),
  text: text || null,
  type: type || "text",
  from_me: fromMe || false,
  media_url: audio?.audioUrl || body.image?.imageUrl || body.video?.videoUrl || null,
  status: type === "audio" ? "pending_transcription" : "received",
}).select("id").single();

if (error) {
  console.error("Failed to save message:", error.message);
}

// Queue audio for transcription
if ((type === "audio" || body.audio) && !error && data) {
  const audioUrl = body.audio?.audioUrl;
  if (audioUrl) {
    await TranscriptionQueue.enqueue({
      instanceId: instance.id,
      messageId: data.id,
      audioUrl,
    });
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/api/webhook/route.ts
git commit -m "feat: wire webhook to transcription queue for audio messages"
```
