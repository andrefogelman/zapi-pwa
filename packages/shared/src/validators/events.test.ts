import { describe, expect, test } from "bun:test";
import { OnAudioEventSchema, OnAudioResponseSchema } from "./events";

describe("OnAudioEventSchema", () => {
  const validEvent = {
    waclaw_session_id: "sess-abc",
    message_id: "msg-123",
    chat_jid: "5511999999999@s.whatsapp.net",
    chat_name: "John Doe",
    sender_phone: "5511988888888",
    sender_name: "Jane",
    from_me: false,
    is_group: false,
    audio_url: "https://worker5/audio/abc.ogg",
    audio_duration_seconds: 5,
    timestamp: "2026-04-11T12:00:00.000Z",
  };

  test("accepts a valid event", () => {
    const result = OnAudioEventSchema.safeParse(validEvent);
    expect(result.success).toBe(true);
  });

  test("accepts sender_name null", () => {
    const result = OnAudioEventSchema.safeParse({ ...validEvent, sender_name: null });
    expect(result.success).toBe(true);
  });

  test("rejects empty waclaw_session_id", () => {
    const result = OnAudioEventSchema.safeParse({ ...validEvent, waclaw_session_id: "" });
    expect(result.success).toBe(false);
  });

  test("rejects invalid audio_url", () => {
    const result = OnAudioEventSchema.safeParse({ ...validEvent, audio_url: "not-a-url" });
    expect(result.success).toBe(false);
  });

  test("rejects negative duration", () => {
    const result = OnAudioEventSchema.safeParse({ ...validEvent, audio_duration_seconds: -1 });
    expect(result.success).toBe(false);
  });

  test("rejects non-ISO timestamp", () => {
    const result = OnAudioEventSchema.safeParse({ ...validEvent, timestamp: "yesterday" });
    expect(result.success).toBe(false);
  });
});

describe("OnAudioResponseSchema", () => {
  test("accepts queued status", () => {
    const r = OnAudioResponseSchema.safeParse({ status: "queued" });
    expect(r.success).toBe(true);
  });

  test("accepts failed with reason", () => {
    const r = OnAudioResponseSchema.safeParse({ status: "failed", reason: "timeout" });
    expect(r.success).toBe(true);
  });

  test("rejects invalid status", () => {
    const r = OnAudioResponseSchema.safeParse({ status: "bogus" });
    expect(r.success).toBe(false);
  });
});
