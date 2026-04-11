import {
  INTERNAL_HEADER_SECRET,
  DAEMON_FORWARD_MAX_RETRIES,
  DAEMON_FORWARD_BACKOFF_MS,
  OnAudioResponseSchema,
  type OnAudioEvent,
  type OnAudioResponse,
} from "zapi-shared";
import { log } from "./logger";

const NEXT_URL = process.env.ZAPI_PWA_URL ?? "https://zapi-pwa.vercel.app";
const SECRET = process.env.INTERNAL_WEBHOOK_SECRET ?? "";

/**
 * Signals that a 4xx response came back and retrying won't help (wrong secret,
 * invalid payload schema, etc.). Thrown out of the retry loop so the daemon
 * logs the permanent failure immediately instead of wasting backoff time.
 */
class PermanentForwardError extends Error {}

/**
 * Posts a validated audio event to the Next /api/internal/on-audio route
 * with exponential backoff retry. 4xx responses are treated as permanent
 * failures and re-thrown immediately. 5xx and network errors are retried up
 * to DAEMON_FORWARD_MAX_RETRIES times with the backoffs in
 * DAEMON_FORWARD_BACKOFF_MS.
 */
export async function forwardAudioEvent(event: OnAudioEvent): Promise<OnAudioResponse> {
  if (!SECRET) throw new Error("INTERNAL_WEBHOOK_SECRET not set");

  let lastErr: unknown;
  for (let attempt = 0; attempt < DAEMON_FORWARD_MAX_RETRIES; attempt++) {
    // Sleep BEFORE retries (not after the last attempt) so we don't waste
    // backoff time on a final attempt that won't be followed by another.
    if (attempt > 0) {
      const backoff = DAEMON_FORWARD_BACKOFF_MS[attempt - 1];
      if (backoff != null) {
        log.warn("retry forward", { attempt, backoff });
        await sleep(backoff);
      }
    }

    try {
      const res = await fetch(`${NEXT_URL}/api/internal/on-audio`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          [INTERNAL_HEADER_SECRET]: SECRET,
        },
        body: JSON.stringify(event),
      });

      if (res.ok) {
        const parsed = OnAudioResponseSchema.safeParse(await res.json());
        if (parsed.success) return parsed.data;
        throw new Error("invalid response from Next");
      }

      // 4xx = permanent, bubble out of the retry loop immediately.
      if (res.status >= 400 && res.status < 500) {
        throw new PermanentForwardError(
          `Next returned ${res.status}: ${await res.text()}`
        );
      }

      // 5xx / transient — record and loop
      lastErr = new Error(`Next returned ${res.status}`);
    } catch (err) {
      if (err instanceof PermanentForwardError) {
        throw err; // escape the for-loop
      }
      lastErr = err;
    }
  }

  throw lastErr ?? new Error("unknown forward failure");
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
