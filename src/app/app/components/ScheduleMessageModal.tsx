"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/lib/use-auth";

interface Props {
  open: boolean;
  onClose: () => void;
  sessionId: string | null;
  chatJid: string | null;
  chatName: string;
}

interface ScheduledMessage {
  id: string;
  text: string;
  scheduled_for: string;
  status: string;
  error: string | null;
  sent_at: string | null;
}

export function ScheduleMessageModal({ open, onClose, sessionId, chatJid, chatName }: Props) {
  const { session } = useAuth();
  const [text, setText] = useState("");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [items, setItems] = useState<ScheduledMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const authHeaders = useCallback((): Record<string, string> => {
    const token = session?.access_token;
    const h: Record<string, string> = { "Content-Type": "application/json" };
    if (token) h.Authorization = `Bearer ${token}`;
    return h;
  }, [session?.access_token]);

  const load = useCallback(async () => {
    if (!sessionId || !chatJid || !session?.access_token) return;
    setLoading(true);
    try {
      const res = await fetch(
        `/api/scheduled?sessionId=${encodeURIComponent(sessionId)}&chatJid=${encodeURIComponent(chatJid)}`,
        { headers: authHeaders() }
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setItems(data.messages || []);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [sessionId, chatJid, session?.access_token, authHeaders]);

  useEffect(() => {
    if (open) {
      setError(null);
      load();
      // Prefill with "now + 1 hour" rounded to nearest 5 min
      const now = new Date(Date.now() + 60 * 60 * 1000);
      now.setMinutes(Math.ceil(now.getMinutes() / 5) * 5, 0, 0);
      const yyyy = now.getFullYear();
      const mm = String(now.getMonth() + 1).padStart(2, "0");
      const dd = String(now.getDate()).padStart(2, "0");
      const hh = String(now.getHours()).padStart(2, "0");
      const mi = String(now.getMinutes()).padStart(2, "0");
      setDate(`${yyyy}-${mm}-${dd}`);
      setTime(`${hh}:${mi}`);
    } else {
      setText("");
      setError(null);
    }
  }, [open, load]);

  async function handleSchedule() {
    if (!sessionId || !chatJid || !text.trim() || !date || !time || busy) return;
    setBusy(true);
    setError(null);
    try {
      // Build ISO timestamp in local timezone
      const scheduledFor = new Date(`${date}T${time}:00`).toISOString();
      const res = await fetch("/api/scheduled", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          sessionId,
          chatJid,
          chatName,
          text: text.trim(),
          scheduledFor,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      setText("");
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleCancel(id: string) {
    if (!confirm("Cancelar este agendamento?")) return;
    try {
      const res = await fetch(`/api/scheduled/${id}`, {
        method: "DELETE",
        headers: authHeaders(),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  function formatWhen(iso: string): string {
    const d = new Date(iso);
    return d.toLocaleString("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      year: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  if (!open) return null;

  return (
    <div className="wa-modal-overlay" onClick={onClose}>
      <div className="wa-modal wa-modal-lg" onClick={(e) => e.stopPropagation()}>
        <div className="wa-modal-header">
          <div className="wa-modal-title">
            Agendar mensagem — {chatName}
          </div>
          <button className="wa-modal-close" onClick={onClose}>✕</button>
        </div>

        <div className="wa-modal-body">
          <label className="wa-modal-label">Mensagem</label>
          <textarea
            className="wa-modal-textarea"
            placeholder="Digite a mensagem..."
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={3}
            disabled={busy}
          />

          <div className="wa-schedule-row">
            <div className="wa-schedule-field">
              <label className="wa-modal-label">Data</label>
              <input
                className="wa-modal-input"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                disabled={busy}
              />
            </div>
            <div className="wa-schedule-field">
              <label className="wa-modal-label">Hora</label>
              <input
                className="wa-modal-input"
                type="time"
                value={time}
                onChange={(e) => setTime(e.target.value)}
                disabled={busy}
              />
            </div>
          </div>

          {error && <div className="wa-modal-error">{error}</div>}

          <button
            className="wa-modal-primary wa-settings-add"
            onClick={handleSchedule}
            disabled={busy || !text.trim() || !date || !time}
          >
            {busy ? "Agendando..." : "Agendar"}
          </button>

          {items.length > 0 && (
            <>
              <div className="wa-settings-section">Agendadas para esta conversa</div>
              {items.map((item) => (
                <div key={item.id} className="wa-schedule-item">
                  <div className="wa-schedule-info">
                    <div className="wa-schedule-text">{item.text}</div>
                    <div className="wa-schedule-meta">
                      {formatWhen(item.scheduled_for)}
                      {" · "}
                      <span className={`wa-schedule-status wa-status-${item.status}`}>
                        {item.status === "pending" && "aguardando"}
                        {item.status === "processing" && "enviando..."}
                        {item.status === "sent" && "enviada"}
                        {item.status === "failed" && `falhou: ${item.error}`}
                        {item.status === "canceled" && "cancelada"}
                      </span>
                    </div>
                  </div>
                  {item.status === "pending" && (
                    <button
                      className="wa-settings-btn wa-settings-danger"
                      onClick={() => handleCancel(item.id)}
                    >
                      Cancelar
                    </button>
                  )}
                </div>
              ))}
            </>
          )}
          {loading && items.length === 0 && (
            <div className="wa-loading sm">Carregando agendadas...</div>
          )}
        </div>
      </div>
    </div>
  );
}
