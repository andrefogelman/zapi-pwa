"use client";

import { useCallback, useState } from "react";
import { useAuth } from "@/lib/use-auth";

interface Props {
  open: boolean;
  onClose: () => void;
  sessionId: string | null;
  chatJid: string | null;
  chatName: string;
}

type Period = "hoje" | "24h" | "3d" | "7d" | "30d";

const PERIODS: Array<{ key: Period; label: string }> = [
  { key: "hoje", label: "Hoje" },
  { key: "24h", label: "24 horas" },
  { key: "3d", label: "3 dias" },
  { key: "7d", label: "7 dias" },
  { key: "30d", label: "30 dias" },
];

export function SummaryModal({ open, onClose, sessionId, chatJid, chatName }: Props) {
  const { session } = useAuth();
  const [period, setPeriod] = useState<Period>("24h");
  const [summary, setSummary] = useState<string | null>(null);
  const [messageCount, setMessageCount] = useState<number>(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const authHeaders = useCallback((): Record<string, string> => {
    const token = session?.access_token;
    const h: Record<string, string> = { "Content-Type": "application/json" };
    if (token) h.Authorization = `Bearer ${token}`;
    return h;
  }, [session?.access_token]);

  async function handleGenerate() {
    if (!sessionId || !chatJid || loading) return;
    setLoading(true);
    setError(null);
    setSummary(null);
    try {
      const res = await fetch("/api/summary", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ sessionId, chatJid, period }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      setSummary(data.summary);
      setMessageCount(data.messageCount || 0);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function handleSendToChat() {
    if (!sessionId || !chatJid || !summary || sending) return;
    setSending(true);
    try {
      const res = await fetch("/api/summary", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ sessionId, chatJid, period, sendBackToChat: true }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSending(false);
    }
  }

  async function handleCopy() {
    if (!summary) return;
    try {
      await navigator.clipboard.writeText(summary);
    } catch {}
  }

  function handleClose() {
    setSummary(null);
    setError(null);
    setLoading(false);
    setSending(false);
    onClose();
  }

  if (!open) return null;

  return (
    <div className="wa-modal-overlay" onClick={handleClose}>
      <div className="wa-modal wa-modal-lg" onClick={(e) => e.stopPropagation()}>
        <div className="wa-modal-header">
          <div className="wa-modal-title">
            Resumir conversa — {chatName}
          </div>
          <button className="wa-modal-close" onClick={handleClose}>✕</button>
        </div>

        <div className="wa-modal-body">
          {!summary && (
            <>
              <label className="wa-modal-label">Período</label>
              <div className="wa-period-picker">
                {PERIODS.map((p) => (
                  <button
                    key={p.key}
                    className={`wa-period-btn ${period === p.key ? "active" : ""}`}
                    onClick={() => setPeriod(p.key)}
                    disabled={loading}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
              <div className="wa-summary-info">
                A IA vai ler as mensagens do período e gerar um resumo com os
                principais tópicos, decisões, tarefas e informações importantes.
              </div>
              {error && <div className="wa-modal-error">{error}</div>}
            </>
          )}

          {summary && (
            <>
              <div className="wa-summary-meta">
                {messageCount} mensagens · {PERIODS.find((p) => p.key === period)?.label}
              </div>
              <div className="wa-summary-content">
                <MarkdownText text={summary} />
              </div>
              {error && <div className="wa-modal-error">{error}</div>}
            </>
          )}
        </div>

        <div className="wa-modal-footer">
          {!summary ? (
            <button
              className="wa-modal-primary"
              onClick={handleGenerate}
              disabled={loading || !sessionId || !chatJid}
            >
              {loading ? "Gerando..." : "Gerar resumo"}
            </button>
          ) : (
            <>
              <button className="wa-modal-secondary" onClick={handleCopy}>
                Copiar
              </button>
              <button
                className="wa-modal-secondary"
                onClick={() => { setSummary(null); setError(null); }}
              >
                Outro período
              </button>
              <button
                className="wa-modal-primary"
                onClick={handleSendToChat}
                disabled={sending}
              >
                {sending ? "Enviando..." : "Enviar no chat"}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// Minimal markdown → React renderer for summaries: headers, bullets, bold,
// italic, paragraphs. Avoids pulling in a full markdown dependency.
function MarkdownText({ text }: { text: string }) {
  const lines = text.split("\n");
  const out: React.ReactNode[] = [];
  let listBuffer: string[] = [];

  function flushList() {
    if (listBuffer.length === 0) return;
    out.push(
      <ul key={out.length}>
        {listBuffer.map((item, i) => (
          <li key={i}>{renderInline(item)}</li>
        ))}
      </ul>
    );
    listBuffer = [];
  }

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (/^#{1,6}\s/.test(line)) {
      flushList();
      const level = line.match(/^(#+)/)?.[1].length || 1;
      const content = line.replace(/^#+\s*/, "");
      const H = `h${Math.min(level + 2, 6)}` as keyof React.JSX.IntrinsicElements;
      out.push(<H key={out.length}>{renderInline(content)}</H>);
    } else if (/^[-*]\s/.test(line)) {
      listBuffer.push(line.replace(/^[-*]\s+/, ""));
    } else if (line.trim() === "") {
      flushList();
    } else {
      flushList();
      out.push(<p key={out.length}>{renderInline(line)}</p>);
    }
  }
  flushList();
  return <>{out}</>;
}

function renderInline(text: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  const regex = /(\*\*([^*]+)\*\*|\*([^*]+)\*|`([^`]+)`)/g;
  let lastIdx = 0;
  let match: RegExpExecArray | null;
  let key = 0;
  while ((match = regex.exec(text))) {
    if (match.index > lastIdx) {
      parts.push(text.slice(lastIdx, match.index));
    }
    if (match[2]) parts.push(<strong key={key++}>{match[2]}</strong>);
    else if (match[3]) parts.push(<em key={key++}>{match[3]}</em>);
    else if (match[4]) parts.push(<code key={key++}>{match[4]}</code>);
    lastIdx = match.index + match[0].length;
  }
  if (lastIdx < text.length) parts.push(text.slice(lastIdx));
  return parts;
}
