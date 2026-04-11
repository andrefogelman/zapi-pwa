/**
 * Header name that the daemon uses to authenticate with /api/internal/on-audio.
 * Both sides import from here to avoid typo drift.
 */
export const INTERNAL_HEADER_SECRET = "X-Zapi-Internal-Secret";

/**
 * Optional header for daemon identification (future: mTLS, multiple daemons).
 */
export const INTERNAL_HEADER_DAEMON_ID = "X-Zapi-Daemon-Id";

/**
 * Maximum audio payload size. Above this, daemon skips without forwarding.
 * Whisper's documented limit is 25 MB.
 */
export const MAX_AUDIO_BYTES = 25 * 1024 * 1024;

/** Number of retry attempts in the daemon's forwarder. */
export const DAEMON_FORWARD_MAX_RETRIES = 3;

/** Backoff delays in ms between retries. Length must be >= DAEMON_FORWARD_MAX_RETRIES. */
export const DAEMON_FORWARD_BACKOFF_MS = [1000, 3000, 10000] as const;
