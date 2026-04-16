import { MAX_AUDIO_BYTES, type OnAudioEvent } from "zapi-shared";
import { log } from "./logger";

interface ConnectOptions {
  waclawUrl: string;
  apiKey: string;
  onAudioMessage: (event: OnAudioEvent) => Promise<void>;
  onError: (err: unknown) => void;
}

/**
 * Subscribes to waclaw events and calls onAudioMessage for each audio event.
 * Reconnects with exponential backoff on failure (1s → 2s → 4s → ... → 30s cap).
 * Returns only when the process is killed.
 *
 * TODO(confirm-waclaw-protocol): the protocol is assumed to be SSE at
 * GET /events with `data: {json}` lines. Validate on first run with:
 *   curl -i -H "X-API-Key: $WACLAW_API_KEY" $WACLAW_URL/events
 * and adjust the transport here if it turns out to be WebSocket or long-poll.
 * No other file in the daemon depends on the transport — only this one.
 */
export async function connectAndSubscribe(opts: ConnectOptions): Promise<void> {
  let backoffMs = 1000;
  const maxBackoffMs = 30_000;

  while (true) {
    try {
      await connect(opts);
      backoffMs = 1000;
    } catch (err) {
      opts.onError(err);
      log.warn("reconnecting", { backoff_ms: backoffMs });
      await sleep(backoffMs);
      backoffMs = Math.min(backoffMs * 2, maxBackoffMs);
    }
  }
}

async function connect(opts: ConnectOptions): Promise<void> {
  // Hypothesis: SSE stream at /events. Adjust if waclaw exposes a different
  // transport (WebSocket, long-poll, etc.).
  const res = await fetch(`${opts.waclawUrl}/events`, {
    headers: {
      "X-API-Key": opts.apiKey,
      Accept: "text/event-stream",
    },
  });
  if (!res.ok || !res.body) {
    throw new Error(`waclaw /events responded ${res.status}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) throw new Error("waclaw stream ended");

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      try {
        const raw: unknown = JSON.parse(line.slice(6));
        const audio = extractAudioEvent(raw);
        if (audio) {
          // Fire-and-forget — don't block the event loop waiting for the
          // forwarder. Errors are swallowed here; the caller's onAudioMessage
          // wrapper must log them.
          opts.onAudioMessage(audio).catch((err) =>
            log.error("onAudioMessage threw", { err: String(err) }),
          );
        }
      } catch (err) {
        log.warn("failed to parse event", { line, err: String(err) });
      }
    }
  }
}

/**
 * Converts a raw waclaw event into an OnAudioEvent. Returns null if:
 * - The event is not a message
 * - The message has no audio field
 * - The audio exceeds MAX_AUDIO_BYTES
 * - Required fields are missing (session_id, message.id, etc.)
 *
 * The raw shape is a hypothesis that must be validated against real waclaw
 * output. Adjust the field mapping as needed after the first curl probe.
 */
function extractAudioEvent(raw: unknown): OnAudioEvent | null {
  if (!isObject(raw)) return null;
  if (raw.type !== "message") return null;

  const message = raw.message;
  if (!isObject(message)) return null;

  const audio = message.audio;
  if (!isObject(audio)) return null;

  if (typeof audio.size_bytes === "number" && audio.size_bytes > MAX_AUDIO_BYTES) {
    log.warn("audio too large, skipping", { size: audio.size_bytes });
    return null;
  }

  const sessionId = raw.session_id;
  const messageId = message.id;
  const chatJid = message.chat_jid;
  const audioUrl = audio.url;
  const timestamp = message.timestamp;

  if (typeof sessionId !== "string" || !sessionId) return null;
  if (typeof messageId !== "string" || !messageId) return null;
  if (typeof chatJid !== "string" || !chatJid) return null;
  if (typeof audioUrl !== "string" || !audioUrl) return null;
  if (timestamp == null) return null;

  return {
    waclaw_session_id: sessionId,
    message_id: messageId,
    chat_jid: chatJid,
    chat_lid: typeof message.chat_lid === "string" && message.chat_lid ? message.chat_lid : undefined,
    chat_name: typeof message.chat_name === "string" ? message.chat_name : "",
    sender_phone: typeof message.from === "string" ? message.from : "",
    sender_lid: typeof message.sender_lid === "string" && message.sender_lid ? message.sender_lid : undefined,
    sender_name: typeof message.sender_name === "string" ? message.sender_name : null,
    from_me: Boolean(message.from_me),
    is_group: chatJid.endsWith("@g.us"),
    audio_url: audioUrl,
    audio_duration_seconds:
      typeof audio.duration_seconds === "number" ? audio.duration_seconds : 0,
    timestamp: new Date(timestamp as string | number).toISOString(),
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
