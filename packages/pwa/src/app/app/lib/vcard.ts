import type { MessageContact } from "../hooks/useMessages";

// Minimal vCard 2.1/3.0/4.0 parser. Handles multi-value fields and line
// unfolding per RFC 6350. Returns null if no FN can be extracted.
export function parseVCard(text: string | null | undefined): MessageContact | null {
  if (!text || !text.includes("BEGIN:VCARD")) return null;

  // Unfold folded lines (lines starting with space continue the previous line)
  const unfolded = text.replace(/\r?\n[ \t]/g, "");
  const lines = unfolded.split(/\r?\n/);

  let displayName = "";
  let organization: string | undefined;
  const phones: { phone: string; type?: string }[] = [];
  const emails: { email: string }[] = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("BEGIN:") || line.startsWith("END:") || line.startsWith("VERSION:")) {
      continue;
    }

    // Split "KEY;PARAM=X:VALUE" into key+params and value
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;
    const prefix = line.slice(0, colonIdx);
    const value = line.slice(colonIdx + 1);
    if (!value) continue;

    const [keyRaw, ...paramParts] = prefix.split(";");
    const key = keyRaw.toUpperCase();
    const params = paramParts.map((p) => p.toUpperCase());

    if (key === "FN") {
      displayName = unescapeVCardValue(value);
    } else if (key === "N" && !displayName) {
      // N is structured: Family;Given;Middle;Prefix;Suffix — fall back if FN missing
      const parts = value.split(";").map(unescapeVCardValue);
      displayName = [parts[1], parts[0]].filter(Boolean).join(" ").trim();
    } else if (key === "ORG") {
      organization = unescapeVCardValue(value.split(";")[0]);
    } else if (key === "TEL") {
      const phone = value.replace(/[^\d+]/g, "");
      if (phone) {
        const type = extractType(params);
        phones.push(type ? { phone, type } : { phone });
      }
    } else if (key === "EMAIL") {
      const email = unescapeVCardValue(value).trim();
      if (email && email.includes("@")) {
        emails.push({ email });
      }
    }
  }

  if (!displayName && phones.length === 0) return null;
  return {
    displayName: displayName || phones[0]?.phone || "Contato",
    phones,
    emails: emails.length > 0 ? emails : undefined,
    organization,
  };
}

function unescapeVCardValue(v: string): string {
  return v
    .replace(/\\n/g, "\n")
    .replace(/\\,/g, ",")
    .replace(/\\;/g, ";")
    .replace(/\\\\/g, "\\");
}

function extractType(params: string[]): string | undefined {
  for (const p of params) {
    if (p.startsWith("TYPE=")) {
      const types = p.slice(5).replace(/"/g, "").split(",");
      const preferred = types.find((t) => ["CELL", "MOBILE", "WORK", "HOME"].includes(t));
      if (preferred) return humanizeType(preferred);
      return humanizeType(types[0]);
    }
    if (["CELL", "MOBILE", "WORK", "HOME", "VOICE", "FAX"].includes(p)) {
      return humanizeType(p);
    }
  }
  return undefined;
}

function humanizeType(t: string): string {
  switch (t.toUpperCase()) {
    case "CELL":
    case "MOBILE":
      return "Celular";
    case "WORK":
      return "Trabalho";
    case "HOME":
      return "Residencial";
    case "FAX":
      return "Fax";
    default:
      return t.toLowerCase();
  }
}
