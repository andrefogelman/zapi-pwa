"use client";

import { useState } from "react";
import type { MessageContact } from "../hooks/useMessages";

interface Props {
  contact: MessageContact;
}

export function ContactMessage({ contact }: Props) {
  const [copied, setCopied] = useState<string | null>(null);

  function formatPhone(phone: string) {
    const c = phone.replace(/\D/g, "");
    if (c.length === 13) return `+${c.slice(0, 2)} (${c.slice(2, 4)}) ${c.slice(4, 9)}-${c.slice(9)}`;
    if (c.length === 12) return `+${c.slice(0, 2)} (${c.slice(2, 4)}) ${c.slice(4, 8)}-${c.slice(8)}`;
    if (c.length === 11) return `(${c.slice(0, 2)}) ${c.slice(2, 7)}-${c.slice(7)}`;
    return phone;
  }

  async function copyPhone(phone: string) {
    await navigator.clipboard.writeText(phone);
    setCopied(phone);
    setTimeout(() => setCopied(null), 2000);
  }

  const initials = contact.displayName
    .split(" ")
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <div className="wa-contact-card">
      <div className="wa-contact-header">
        <div className="wa-contact-avatar">{initials}</div>
        <div className="wa-contact-info">
          <div className="wa-contact-name">{contact.displayName}</div>
          {contact.organization && (
            <div className="wa-contact-org">{contact.organization}</div>
          )}
        </div>
      </div>

      {contact.phones.map((p, i) => (
        <div key={i} className="wa-contact-row">
          <span className="wa-contact-phone-icon">📞</span>
          <span className="wa-contact-phone">{formatPhone(p.phone)}</span>
          {p.type && <span className="wa-contact-badge">{p.type}</span>}
          <button className="wa-contact-copy" onClick={() => copyPhone(p.phone)}>
            {copied === p.phone ? "✓" : "📋"}
          </button>
        </div>
      ))}

      {contact.emails?.map((e, i) => (
        <div key={i} className="wa-contact-row">
          <span className="wa-contact-phone-icon">✉️</span>
          <a href={`mailto:${e.email}`} className="wa-contact-email">{e.email}</a>
        </div>
      ))}
    </div>
  );
}
