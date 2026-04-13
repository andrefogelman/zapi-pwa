"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/lib/use-auth";
import { AttachMenu } from "./AttachMenu";

interface Props {
  open: boolean;
  onClose: () => void;
  sessionId: string | null;
  chatJid: string | null;
  chatName: string;
}

interface ScheduledMessage {
  id: string;
  text: string | null;
  scheduled_for: string;
  status: string;
  error: string | null;
  sent_at: string | null;
  media_filename: string | null;
  media_mime_type: string | null;
}

interface AttachedFile {
  file: File;
  dataBase64: string;
}

function fileIcon(mime: string | null | undefined): string {
  if (!mime) return "📄";
  if (mime.startsWith("image/")) return "🖼️";
  if (mime.startsWith("video/")) return "🎬";
  if (mime.startsWith("audio/")) return "🎵";
  if (mime.includes("pdf")) return "📑";
  return "📄";
}

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const MAX_FILE_BYTES = 8 * 1024 * 1024; // 8 MB

export function ScheduleMessageModal({ open, onClose, sessionId, chatJid, chatName }: Props) {
  const { session } = useAuth();
  const [text, setText] = useState("");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [items, setItems] = useState<ScheduledMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attachMenuOpen, setAttachMenuOpen] = useState(false);
  const [attached, setAttached] = useState<AttachedFile | null>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const documentInputRef = useRef<HTMLInputElement>(null);

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
      setAttached(null);
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
      setAttached(null);
    }
  }, [open, load]);

  async function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) {
      setError(`Arquivo muito grande (máx. ${humanSize(MAX_FILE_BYTES)})`);
      return;
    }
    try {
      const dataBase64 = await fileToBase64(file);
      setAttached({ file, dataBase64 });
      setError(null);
    } catch {
      setError("Falha ao ler o arquivo.");
    }
  }

  async function handleSchedule() {
    const hasText = text.trim().length > 0;
    const hasFile = !!attached;
    if (!sessionId || !chatJid || (!hasText && !hasFile) || !date || !time || busy) return;
    setBusy(true);
    setError(null);
    try {
      const scheduledFor = new Date(`${date}T${time}:00`).toISOString();
      const body: Record<string, unknown> = {
        sessionId,
        chatJid,
        chatName,
        scheduledFor,
      };
      if (hasText) body.text = text.trim();
      if (hasFile) {
        body.mediaBase64 = attached.dataBase64;
        body.mediaFilename = attached.file.name;
        body.mediaMimeType = attached.file.type || "application/octet-stream";
        if (!hasText) body.text = ""; // API may require field; send empty
      }
      const res = await fetch("/api/scheduled", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      setText("");
      setAttached(null);
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

  const canSchedule = (text.trim().length > 0 || !!attached) && !!date && !!time && !busy;

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
          <label className="wa-modal-label">Mensagem{attached ? " (legenda opcional)" : ""}</label>
          <div className="wa-schedule-compose">
            <div className="wa-schedule-attach-wrap">
              <button
                className="wa-attach-btn"
                onClick={() => setAttachMenuOpen((v) => !v)}
                disabled={busy}
                title="Anexar arquivo"
              >
                <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor">
                  <path d="M1.816 15.556v.002c0 1.502.584 2.912 1.646 3.972s2.472 1.647 3.974 1.647a5.58 5.58 0 0 0 3.972-1.645l9.547-9.548c.769-.768 1.147-1.767 1.058-2.817-.079-.968-.548-1.927-1.319-2.698-1.594-1.592-4.068-1.711-5.517-.262l-7.916 7.915c-.881.881-.792 2.25.214 3.261.959.958 2.423 1.053 3.263.215l5.511-5.512c.28-.28.267-.722.053-.936l-.244-.244c-.191-.191-.567-.349-.957.04l-5.506 5.506c-.18.18-.635.127-.976-.214-.098-.097-.576-.613-.213-.973l7.915-7.917c.818-.817 2.267-.699 3.23.262.5.501.802 1.1.849 1.685.051.573-.156 1.111-.589 1.543l-9.547 9.549a3.97 3.97 0 0 1-2.829 1.171 3.975 3.975 0 0 1-2.83-1.173 3.973 3.973 0 0 1-1.172-2.828c0-1.071.415-2.076 1.172-2.83l7.209-7.211c.157-.157.264-.579.028-.814L11.5 4.36a.572.572 0 0 0-.834.018l-7.205 7.207a5.577 5.577 0 0 0-1.645 3.971z"/>
                </svg>
              </button>
              <AttachMenu
                open={attachMenuOpen}
                onClose={() => setAttachMenuOpen(false)}
                onPickPhoto={() => photoInputRef.current?.click()}
                onPickDocument={() => documentInputRef.current?.click()}
                onPickContact={() => {}}
                onPickAIImage={() => {}}
                hideExtras
              />
            </div>
            <textarea
              className="wa-modal-textarea"
              placeholder={attached ? "Legenda (opcional)..." : "Digite a mensagem..."}
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={3}
              disabled={busy}
            />
          </div>

          {/* Attached file preview */}
          {attached && (
            <div className="wa-schedule-file-preview">
              <span className="wa-schedule-file-icon">{fileIcon(attached.file.type)}</span>
              <div className="wa-schedule-file-info">
                <div className="wa-schedule-file-name">{attached.file.name}</div>
                <div className="wa-schedule-file-size">{humanSize(attached.file.size)}</div>
              </div>
              <button
                className="wa-schedule-file-remove"
                onClick={() => setAttached(null)}
                title="Remover anexo"
                disabled={busy}
              >
                ✕
              </button>
            </div>
          )}

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
            disabled={!canSchedule}
          >
            {busy ? "Agendando..." : "Agendar"}
          </button>

          {items.length > 0 && (
            <>
              <div className="wa-settings-section">Agendadas para esta conversa</div>
              {items.map((item) => (
                <div key={item.id} className="wa-schedule-item">
                  <div className="wa-schedule-info">
                    <div className="wa-schedule-text">
                      {item.media_filename && (
                        <span className="wa-schedule-attach-badge">
                          {fileIcon(item.media_mime_type)} {item.media_filename}
                          {item.text ? " · " : ""}
                        </span>
                      )}
                      {item.text || ""}
                    </div>
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

      {/* Hidden file inputs */}
      <input
        ref={photoInputRef}
        type="file"
        accept="image/*,video/*"
        hidden
        onChange={handleFileSelected}
      />
      <input
        ref={documentInputRef}
        type="file"
        hidden
        onChange={handleFileSelected}
      />
    </div>
  );
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(reader.error || new Error("File read failed"));
    reader.readAsDataURL(file);
  });
}
