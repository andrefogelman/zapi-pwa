import { describe, expect, test } from "bun:test";
import { filterMessage } from "../filter";
import type { OnAudioEvent } from "zapi-shared";

const baseEvent: OnAudioEvent = {
  waclaw_session_id: "sess",
  message_id: "msg-1",
  chat_jid: "5511999999999@s.whatsapp.net",
  chat_name: "John",
  sender_phone: "5511988888888",
  sender_name: "Jane",
  from_me: false,
  is_group: false,
  audio_url: "https://worker/a.ogg",
  audio_duration_seconds: 5,
  timestamp: "2026-04-11T12:00:00.000Z",
};

const baseInstance = {
  my_phones: [] as string[],
  my_lids: [] as string[],
  connected_phone: "5511977777777",
};

describe("filterMessage — DMs", () => {
  test("DM from another person → process with reply", () => {
    const r = filterMessage({ event: baseEvent, instance: baseInstance, group: null });
    expect(r).toEqual({ action: "process", sendReply: true });
  });

  test("DM echo from own connected_phone → skip", () => {
    const r = filterMessage({
      event: { ...baseEvent, sender_phone: "5511977777777" },
      instance: baseInstance,
      group: null,
    });
    expect(r).toEqual({ action: "skip", reason: "self" });
  });

  test("DM from a number in my_phones → skip", () => {
    const r = filterMessage({
      event: { ...baseEvent, sender_phone: "5511966666666" },
      instance: { ...baseInstance, my_phones: ["5511966666666"] },
      group: null,
    });
    expect(r).toEqual({ action: "skip", reason: "self" });
  });

  test("DM where chat_jid matches my_lids → skip", () => {
    const r = filterMessage({
      event: { ...baseEvent, chat_jid: "249520503971936@lid" },
      instance: { ...baseInstance, my_lids: ["249520503971936@lid"] },
      group: null,
    });
    expect(r).toEqual({ action: "skip", reason: "self" });
  });

  test("group chat_jid never matches my_lids (harmless even with stray LID entries)", () => {
    const r = filterMessage({
      event: { ...baseEvent, is_group: true, chat_jid: "120363@g.us" },
      instance: { ...baseInstance, my_lids: ["unrelated@lid"] },
      group: { transcribe_all: true, send_reply: true },
    });
    expect(r).toEqual({ action: "process", sendReply: true });
  });
});

describe("filterMessage — groups", () => {
  const groupEvent: OnAudioEvent = {
    ...baseEvent,
    is_group: true,
    chat_jid: "120363@g.us",
  };

  test("group not in authorized list → skip", () => {
    const r = filterMessage({ event: groupEvent, instance: baseInstance, group: null });
    expect(r).toEqual({ action: "skip", reason: "group not authorized" });
  });

  test("group authorized, from me → process (reply per group config)", () => {
    const r = filterMessage({
      event: { ...groupEvent, from_me: true },
      instance: baseInstance,
      group: { transcribe_all: false, send_reply: false },
    });
    expect(r).toEqual({ action: "process", sendReply: false });
  });

  test("group authorized, not from me, transcribe_all=false → skip", () => {
    const r = filterMessage({
      event: groupEvent,
      instance: baseInstance,
      group: { transcribe_all: false, send_reply: true },
    });
    expect(r).toEqual({ action: "skip", reason: "transcribe_all disabled" });
  });

  test("group authorized, not from me, transcribe_all=true, send_reply=true → process with reply", () => {
    const r = filterMessage({
      event: groupEvent,
      instance: baseInstance,
      group: { transcribe_all: true, send_reply: true },
    });
    expect(r).toEqual({ action: "process", sendReply: true });
  });

  test("group authorized, transcribe_all=true, send_reply=false → process without reply", () => {
    const r = filterMessage({
      event: groupEvent,
      instance: baseInstance,
      group: { transcribe_all: true, send_reply: false },
    });
    expect(r).toEqual({ action: "process", sendReply: false });
  });
});
