import { z } from "zod";

/**
 * The event the daemon forwards to the Next /api/internal/on-audio route.
 * Single source of truth — type is inferred from the schema below.
 */
export const OnAudioEventSchema = z.object({
  waclaw_session_id: z.string().min(1),
  message_id: z.string().min(1),
  chat_jid: z.string().min(1),
  chat_name: z.string(),
  sender_phone: z.string(),
  sender_name: z.string().nullable(),
  from_me: z.boolean(),
  is_group: z.boolean(),
  audio_url: z.string().url(),
  audio_duration_seconds: z.number().int().nonnegative(),
  timestamp: z.string().datetime({ offset: true }),
});

export type OnAudioEvent = z.infer<typeof OnAudioEventSchema>;

/** Response the Next route returns to the daemon. Used only for logs. */
export const OnAudioResponseSchema = z.object({
  status: z.enum(["queued", "skipped", "transcribed", "failed"]),
  reason: z.string().optional(),
});

export type OnAudioResponse = z.infer<typeof OnAudioResponseSchema>;
