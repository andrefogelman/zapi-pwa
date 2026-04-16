/**
 * WhatsApp JID utilities.
 *
 * A JID is `<user>@<server>` where server is one of:
 *   - `s.whatsapp.net` — phone-addressed personal account
 *   - `lid`            — hidden/local identifier (stable surrogate)
 *   - `g.us`           — group
 *   - `broadcast`      — broadcast list
 *   - `newsletter`     — channels
 *
 * The Z-API guidance (April 2026) says the same contact may appear under
 * `<phone>@s.whatsapp.net` and `<digits>@lid` interchangeably, so callers
 * should always compare *both* forms when matching a contact. Use
 * `jidsMatchContact()` below instead of raw string equality.
 */

export type JIDServer = "s.whatsapp.net" | "lid" | "g.us" | "broadcast" | "newsletter" | "unknown";

export interface ParsedJID {
  user: string;
  server: JIDServer;
  raw: string;
}

export function parseJID(input: string | null | undefined): ParsedJID | null {
  if (!input) return null;
  const atIdx = input.lastIndexOf("@");
  if (atIdx <= 0 || atIdx === input.length - 1) return null;
  const user = input.slice(0, atIdx);
  const serverRaw = input.slice(atIdx + 1).toLowerCase();
  let server: JIDServer = "unknown";
  if (serverRaw === "s.whatsapp.net" || serverRaw === "c.us") server = "s.whatsapp.net";
  else if (serverRaw === "lid") server = "lid";
  else if (serverRaw === "g.us") server = "g.us";
  else if (serverRaw === "broadcast") server = "broadcast";
  else if (serverRaw === "newsletter") server = "newsletter";
  return { user, server, raw: input };
}

export function isLid(jid: string | null | undefined): boolean {
  return parseJID(jid)?.server === "lid";
}

export function isPhoneJid(jid: string | null | undefined): boolean {
  return parseJID(jid)?.server === "s.whatsapp.net";
}

export function isGroupJid(jid: string | null | undefined): boolean {
  return parseJID(jid)?.server === "g.us";
}

/**
 * Normalize a JID so legacy `@c.us` is rewritten to the current `@s.whatsapp.net`.
 * Returns the input unchanged if it isn't a recognizable JID.
 */
export function normalizeJID(jid: string | null | undefined): string | null {
  const p = parseJID(jid);
  if (!p) return jid ?? null;
  return `${p.user}@${p.server === "unknown" ? jid!.split("@")[1] : p.server}`;
}

/**
 * Extract the phone number from a `<phone>@s.whatsapp.net` JID.
 * Returns null for non-phone JIDs (LID, group, etc.).
 */
export function phoneFromJID(jid: string | null | undefined): string | null {
  const p = parseJID(jid);
  if (!p || p.server !== "s.whatsapp.net") return null;
  return p.user;
}

/**
 * Check whether two identifiers refer to the same contact, considering both
 * phone and LID forms. Pass any combination of `jid`, `lid`, and raw phone.
 *
 * Returns true if:
 *   - any JID equals another (after normalization), OR
 *   - any LID equals another, OR
 *   - the phone portion of a phone-JID equals a bare phone input.
 *
 * Does NOT resolve phone↔LID mapping on its own — that requires external
 * data. Use this after you've loaded the contact row (which stores both).
 */
export function jidsMatchContact(
  a: { jid?: string | null; lid?: string | null; phone?: string | null },
  b: { jid?: string | null; lid?: string | null; phone?: string | null },
): boolean {
  const aJid = normalizeJID(a.jid);
  const bJid = normalizeJID(b.jid);
  if (aJid && bJid && aJid === bJid) return true;
  if (a.lid && b.lid && a.lid === b.lid) return true;
  const aPhone = a.phone || phoneFromJID(aJid);
  const bPhone = b.phone || phoneFromJID(bJid);
  if (aPhone && bPhone && aPhone === bPhone) return true;
  return false;
}
