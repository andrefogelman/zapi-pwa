"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/lib/use-auth";
import type { Chat } from "../hooks/useChats";
import { formatChatName, getInitials, avatarColor } from "../lib/formatters";

interface Props {
  chat: Chat;
  sessionId: string;
  onClose: () => void;
}

interface ContactInfo {
  jid: string;
  lid?: string;
  liveLid?: string;
  phone?: string;
  pushName?: string;
  fullName?: string;
  businessName?: string;
  verifiedName?: string;
  status?: string;
  messageCount?: number;
  firstMessage?: number;
  lastMessage?: number;
}

function formatTs(ts: number | undefined): string {
  if (!ts) return "—";
  return new Date(ts * 1000).toLocaleString("pt-BR", { day: "2-digit", month: "short", year: "numeric" });
}

function formatPhone(phone: string): string {
  const d = phone.replace(/\D/g, "");
  if (d.length >= 12 && d.startsWith("55")) {
    const ddd = d.slice(2, 4);
    const rest = d.slice(4);
    if (rest.length === 9) return `+55 (${ddd}) ${rest.slice(0, 5)}-${rest.slice(5)}`;
    if (rest.length === 8) return `+55 (${ddd}) ${rest.slice(0, 4)}-${rest.slice(4)}`;
  }
  return d ? `+${d}` : phone;
}

export function ContactInfoModal({ chat, sessionId, onClose }: Props) {
  const { session } = useAuth();
  const [info, setInfo] = useState<ContactInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const displayName = formatChatName(chat.jid, chat.name);

  useEffect(() => {
    if (!session?.access_token) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await fetch(
          `/api/waclaw/sessions/${sessionId}/contacts/${encodeURIComponent(chat.jid)}`,
          { headers: { Authorization: `Bearer ${session.access_token}` } },
        );
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) setInfo(data);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [chat.jid, sessionId, session?.access_token]);

  return (
    <div className="wa-modal-overlay" onClick={onClose}>
      <div className="wa-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 420 }}>
        <div className="wa-modal-header">
          <span className="wa-modal-title">Informações do contato</span>
          <button className="wa-modal-close" onClick={onClose}>×</button>
        </div>

        <div style={{ padding: "16px 20px" }}>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "16px 0" }}>
            {chat.profilePicUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={chat.profilePicUrl} alt="" style={{ width: 96, height: 96, borderRadius: "50%", objectFit: "cover" }} />
            ) : (
              <div
                style={{
                  width: 96,
                  height: 96,
                  borderRadius: "50%",
                  background: avatarColor(chat.jid),
                  color: "#fff",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 36,
                  fontWeight: 500,
                }}
              >
                {getInitials(displayName)}
              </div>
            )}
            <div style={{ marginTop: 12, fontSize: 20, fontWeight: 500, color: "#e9edef" }}>{displayName}</div>
            {info?.verifiedName && (
              <div style={{ fontSize: 12, color: "#00a884", marginTop: 2 }}>✓ {info.verifiedName}</div>
            )}
            {info?.status && (
              <div style={{ fontSize: 13, color: "#8696a0", marginTop: 6, fontStyle: "italic", textAlign: "center" }}>
                “{info.status}”
              </div>
            )}
          </div>

          {loading && <div style={{ color: "#8696a0", textAlign: "center" }}>Carregando...</div>}

          {info && (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <Field label="Telefone" value={info.phone ? formatPhone(info.phone) : "—"} copy={info.phone} />
              <Field label="JID" value={info.jid} copy={info.jid} small />
              {info.lid && <Field label="LID" value={info.lid} small />}
              <Field label="Tipo" value={chat.isGroup ? "Grupo" : "Conversa"} />
              <Field label="Mensagens trocadas" value={String(info.messageCount ?? 0)} />
              <Field label="Primeira mensagem" value={formatTs(info.firstMessage)} />
              <Field label="Última mensagem" value={formatTs(info.lastMessage)} />
              {chat.blocked && (
                <div style={{ background: "rgba(239,68,68,0.12)", border: "1px solid rgba(239,68,68,0.3)", padding: "8px 12px", borderRadius: 6, color: "#ef4444", fontSize: 13, textAlign: "center" }}>
                  🚫 Este contato está bloqueado
                </div>
              )}
              {chat.mutedUntil > 0 && chat.mutedUntil > Math.floor(Date.now() / 1000) && (
                <div style={{ background: "rgba(245,158,11,0.12)", border: "1px solid rgba(245,158,11,0.3)", padding: "8px 12px", borderRadius: 6, color: "#f59e0b", fontSize: 13, textAlign: "center" }}>
                  🔇 Silenciado
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Field({ label, value, copy, small }: { label: string; value: string; copy?: string; small?: boolean }) {
  return (
    <div>
      <div style={{ color: "#8696a0", fontSize: 11, textTransform: "uppercase", fontWeight: 500, letterSpacing: 0.4 }}>{label}</div>
      <div
        style={{
          color: "#e9edef",
          fontSize: small ? 12 : 14,
          wordBreak: "break-all",
          marginTop: 2,
          cursor: copy ? "pointer" : "default",
        }}
        onClick={copy ? () => navigator.clipboard.writeText(copy) : undefined}
        title={copy ? "Clique para copiar" : undefined}
      >
        {value}
      </div>
    </div>
  );
}
