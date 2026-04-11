/**
 * Minimal waclaw REST client used by /api/instances/* and /api/internal/on-audio.
 * Works against the self-hosted waclaw service on worker5.
 *
 * Endpoint shapes are based on the hypothesis documented in the spec.
 * Validate with curl on first use and adjust if waclaw's real API differs.
 *
 * All requests time out after WACLAW_TIMEOUT_MS to avoid hanging Vercel functions
 * when the worker is slow or unreachable.
 */

const WACLAW_URL = process.env.WACLAW_URL ?? "http://100.66.83.22:3100";
const WACLAW_API_KEY = process.env.WACLAW_API_KEY ?? "waclaw-dev-key";
const WACLAW_TIMEOUT_MS = 15_000;

function headers(): Record<string, string> {
  return {
    "X-API-Key": WACLAW_API_KEY,
    "Content-Type": "application/json",
  };
}

/**
 * fetch wrapper that aborts after WACLAW_TIMEOUT_MS. Callers still handle the
 * thrown AbortError or network error — this only prevents indefinite hangs.
 */
async function timedFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), WACLAW_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(tid);
  }
}

export interface WaclawSession {
  id: string;
  status: "pending" | "connecting" | "connected" | "disconnected";
  phone?: string;
}

export interface WaclawQR {
  qr: string;
  format: "string" | "png_base64";
}

export interface WaclawGroup {
  group_id: string;
  subject: string;
  subject_owner?: string;
  group_lid?: string;
}

export async function createSession(name: string): Promise<{ id: string }> {
  const res = await timedFetch(`${WACLAW_URL}/sessions`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ name }),
  });
  if (!res.ok) {
    throw new Error(`waclaw createSession ${res.status}: ${await res.text()}`);
  }
  return res.json();
}

export async function getSessionStatus(sessionId: string): Promise<WaclawSession> {
  const res = await timedFetch(
    `${WACLAW_URL}/sessions/${encodeURIComponent(sessionId)}`,
    { headers: headers() }
  );
  if (!res.ok) {
    throw new Error(`waclaw getSessionStatus ${sessionId} ${res.status}: ${await res.text()}`);
  }
  return res.json();
}

export async function getSessionQR(sessionId: string): Promise<WaclawQR> {
  const res = await timedFetch(
    `${WACLAW_URL}/sessions/${encodeURIComponent(sessionId)}/qr`,
    { headers: headers() }
  );
  if (!res.ok) {
    throw new Error(`waclaw getSessionQR ${sessionId} ${res.status}: ${await res.text()}`);
  }
  const body = await res.json();
  // Normalize: waclaw may return { qr: "2@..." } or { qr_png_base64: "..." }.
  if (typeof body.qr === "string") {
    return { qr: body.qr, format: "string" };
  }
  if (typeof body.qr_png_base64 === "string") {
    return { qr: body.qr_png_base64, format: "png_base64" };
  }
  throw new Error(`waclaw getSessionQR ${sessionId} response has neither qr nor qr_png_base64`);
}

export async function deleteSession(sessionId: string): Promise<void> {
  const res = await timedFetch(
    `${WACLAW_URL}/sessions/${encodeURIComponent(sessionId)}`,
    { method: "DELETE", headers: headers() }
  );
  if (!res.ok && res.status !== 404) {
    throw new Error(`waclaw deleteSession ${sessionId} ${res.status}: ${await res.text()}`);
  }
}

export async function fetchSessionGroups(sessionId: string): Promise<WaclawGroup[]> {
  const res = await timedFetch(
    `${WACLAW_URL}/sessions/${encodeURIComponent(sessionId)}/groups`,
    { headers: headers() }
  );
  if (!res.ok) {
    throw new Error(`waclaw fetchSessionGroups ${sessionId} ${res.status}: ${await res.text()}`);
  }
  const body = await res.json();
  return Array.isArray(body) ? body : (body.groups ?? []);
}

export async function sendMessage(params: {
  sessionId: string;
  chatJid: string;
  text: string;
  replyToMessageId?: string;
}): Promise<void> {
  const res = await timedFetch(
    `${WACLAW_URL}/sessions/${encodeURIComponent(params.sessionId)}/send-message`,
    {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({
        chat_jid: params.chatJid,
        text: params.text,
        reply_to: params.replyToMessageId,
      }),
    }
  );
  if (!res.ok) {
    throw new Error(
      `waclaw sendMessage ${params.sessionId} → ${params.chatJid} ${res.status}: ${await res.text()}`
    );
  }
}
