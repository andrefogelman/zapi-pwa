"use client";

import { useEffect } from "react";
import type { Message } from "../hooks/useMessages";
import { formatSenderName } from "../lib/formatters";
import { linkify } from "../lib/linkify";

interface Props {
  msg: Message;
  onClose: () => void;
}

function formatFullTs(ts: number): string {
  const d = new Date(ts < 1e12 ? ts * 1000 : ts);
  return d.toLocaleString("pt-BR", {
    day: "2-digit", month: "long", year: "numeric",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
}

function formatBytes(n: number | null | undefined): string {
  if (!n || n <= 0) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function MessagePreviewModal({ msg, onClose }: Props) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const content = msg.text || msg.mediaCaption || "";

  return (
    <div className="wa-modal-overlay" onClick={onClose}>
      <div
        className="wa-modal"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: 720, maxHeight: "88vh", display: "flex", flexDirection: "column" }}
      >
        <div className="wa-modal-header">
          <span className="wa-modal-title">Preview do conteúdo</span>
          <button className="wa-modal-close" onClick={onClose}>×</button>
        </div>

        <div className="wa-modal-body" style={{ padding: "16px 20px", overflowY: "auto", flex: 1 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <Row label="De" value={formatSenderName(msg.senderName, msg.senderJid) + (msg.fromMe ? " (você)" : "")} />
            <Row label="Quando" value={formatFullTs(msg.timestamp)} />
            <Row label="ID" value={msg.id} small copy />
            {msg.type && <Row label="Tipo" value={msg.type} />}
            {msg.mimeType && <Row label="MIME" value={msg.mimeType} small />}
            {msg.filename && <Row label="Arquivo" value={msg.filename} />}

            {msg.reactions && msg.reactions.length > 0 && (
              <Row
                label="Reações"
                value={msg.reactions.map((r) => `${r.emoji}${r.count > 1 ? ` ${r.count}` : ""}`).join("  ")}
              />
            )}

            {/* Media preview */}
            {msg.mediaUrl && (msg.type === "image") && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={msg.mediaUrl} alt="" style={{ maxWidth: "100%", borderRadius: 8 }} />
            )}
            {msg.mediaUrl && (msg.type === "video") && (
              <video src={msg.mediaUrl} controls style={{ maxWidth: "100%", borderRadius: 8 }} />
            )}
            {msg.mediaUrl && (msg.type === "audio" || msg.type === "ptt") && (
              <audio src={msg.mediaUrl} controls style={{ width: "100%" }} />
            )}
            {msg.mediaUrl && (msg.type === "document") && (
              <a
                href={msg.mediaUrl}
                target="_blank"
                rel="noopener noreferrer"
                download={msg.filename || undefined}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "10px 14px",
                  background: "rgba(0,168,132,0.12)",
                  border: "1px solid rgba(0,168,132,0.3)",
                  borderRadius: 8,
                  color: "#00a884",
                  textDecoration: "none",
                  fontSize: 14,
                }}
              >
                📄 Abrir documento {msg.filename ? `"${msg.filename}"` : ""}
              </a>
            )}

            {/* Transcription */}
            {msg.transcription && (
              <div>
                <div style={{ color: "#8696a0", fontSize: 11, textTransform: "uppercase", fontWeight: 500, letterSpacing: 0.4, marginBottom: 4 }}>
                  Transcrição
                </div>
                <div style={{ background: "rgba(0,168,132,0.08)", borderLeft: "3px solid #00a884", padding: "10px 12px", borderRadius: "0 8px 8px 0", color: "#e9edef", fontSize: 14, whiteSpace: "pre-wrap" }}>
                  {msg.transcription}
                </div>
              </div>
            )}

            {/* Text / caption */}
            {content && (
              <div>
                <div style={{ color: "#8696a0", fontSize: 11, textTransform: "uppercase", fontWeight: 500, letterSpacing: 0.4, marginBottom: 4 }}>
                  {msg.type === "image" || msg.type === "video" ? "Legenda" : "Texto"}
                </div>
                <div style={{ background: "rgba(255,255,255,0.04)", padding: "10px 12px", borderRadius: 8, color: "#e9edef", fontSize: 14, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                  {linkify(content)}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value, copy, small }: { label: string; value: string; copy?: boolean; small?: boolean }) {
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
        onClick={copy ? () => navigator.clipboard.writeText(value) : undefined}
        title={copy ? "Clique para copiar" : undefined}
      >
        {value}
      </div>
    </div>
  );
}
