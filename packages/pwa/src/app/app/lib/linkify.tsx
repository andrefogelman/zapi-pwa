import type { ReactNode } from "react";

// Matches http(s) URLs, www.* bare hosts, and whatsapp chat.whatsapp.com
// links. Trailing punctuation (.,;:!?) is stripped so "see https://x.com."
// doesn't turn into a link to "https://x.com.".
const URL_RE = /(https?:\/\/[^\s<>"']+|www\.[^\s<>"']+)/g;
const TRAILING_PUNCT = /[.,;:!?)\]}]+$/;

export function linkify(text: string | null | undefined): ReactNode[] {
  if (!text) return [];
  const out: ReactNode[] = [];
  let last = 0;
  let match: RegExpExecArray | null;
  URL_RE.lastIndex = 0;
  let i = 0;
  while ((match = URL_RE.exec(text)) !== null) {
    const start = match.index;
    let raw = match[0];
    const trailing = raw.match(TRAILING_PUNCT);
    let end = start + raw.length;
    if (trailing) {
      raw = raw.slice(0, raw.length - trailing[0].length);
      end -= trailing[0].length;
    }
    if (start > last) out.push(text.slice(last, start));
    const href = raw.startsWith("www.") ? `https://${raw}` : raw;
    out.push(
      <a
        key={`lnk-${i++}`}
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="wa-msg-link"
      >
        {raw}
      </a>,
    );
    if (trailing) out.push(trailing[0]);
    last = end + (trailing ? trailing[0].length : 0);
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}
