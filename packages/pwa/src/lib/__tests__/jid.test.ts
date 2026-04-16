import { describe, expect, test } from "bun:test";
import { parseJID, isLid, isPhoneJid, isGroupJid, normalizeJID, phoneFromJID, jidsMatchContact } from "../jid";

describe("parseJID", () => {
  test("phone JID", () => {
    expect(parseJID("5511999999999@s.whatsapp.net")).toEqual({
      user: "5511999999999", server: "s.whatsapp.net", raw: "5511999999999@s.whatsapp.net",
    });
  });
  test("LID", () => {
    expect(parseJID("249520503971936@lid")).toEqual({
      user: "249520503971936", server: "lid", raw: "249520503971936@lid",
    });
  });
  test("group", () => {
    expect(parseJID("120363@g.us")?.server).toBe("g.us");
  });
  test("legacy c.us normalizes to s.whatsapp.net", () => {
    expect(parseJID("5511999999999@c.us")?.server).toBe("s.whatsapp.net");
  });
  test("rejects malformed", () => {
    expect(parseJID("")).toBeNull();
    expect(parseJID(null)).toBeNull();
    expect(parseJID("noatsign")).toBeNull();
    expect(parseJID("@nothing")).toBeNull();
    expect(parseJID("user@")).toBeNull();
  });
});

describe("type predicates", () => {
  test("isLid", () => {
    expect(isLid("1@lid")).toBe(true);
    expect(isLid("1@s.whatsapp.net")).toBe(false);
  });
  test("isPhoneJid", () => {
    expect(isPhoneJid("1@s.whatsapp.net")).toBe(true);
    expect(isPhoneJid("1@c.us")).toBe(true);
    expect(isPhoneJid("1@lid")).toBe(false);
  });
  test("isGroupJid", () => {
    expect(isGroupJid("120363@g.us")).toBe(true);
    expect(isGroupJid("1@lid")).toBe(false);
  });
});

describe("normalizeJID", () => {
  test("rewrites c.us → s.whatsapp.net", () => {
    expect(normalizeJID("5511999999999@c.us")).toBe("5511999999999@s.whatsapp.net");
  });
  test("passthrough for lid and group", () => {
    expect(normalizeJID("1@lid")).toBe("1@lid");
    expect(normalizeJID("120363@g.us")).toBe("120363@g.us");
  });
  test("returns input for non-JID strings", () => {
    expect(normalizeJID("plainstring")).toBe("plainstring");
    expect(normalizeJID(null)).toBeNull();
  });
});

describe("phoneFromJID", () => {
  test("extracts from phone JID", () => {
    expect(phoneFromJID("5511999999999@s.whatsapp.net")).toBe("5511999999999");
  });
  test("null for LID", () => {
    expect(phoneFromJID("1@lid")).toBeNull();
  });
});

describe("jidsMatchContact", () => {
  test("same JID matches", () => {
    expect(jidsMatchContact({ jid: "5511@s.whatsapp.net" }, { jid: "5511@s.whatsapp.net" })).toBe(true);
  });
  test("same LID matches even with different JID", () => {
    expect(jidsMatchContact(
      { jid: "5511@s.whatsapp.net", lid: "999@lid" },
      { jid: "5522@s.whatsapp.net", lid: "999@lid" },
    )).toBe(true);
  });
  test("phone extracted from JID matches bare phone", () => {
    expect(jidsMatchContact({ jid: "5511@s.whatsapp.net" }, { phone: "5511" })).toBe(true);
  });
  test("c.us vs s.whatsapp.net normalized", () => {
    expect(jidsMatchContact({ jid: "5511@c.us" }, { jid: "5511@s.whatsapp.net" })).toBe(true);
  });
  test("different contacts do not match", () => {
    expect(jidsMatchContact({ jid: "1@lid" }, { jid: "2@lid" })).toBe(false);
    expect(jidsMatchContact({ phone: "1" }, { phone: "2" })).toBe(false);
  });
});
