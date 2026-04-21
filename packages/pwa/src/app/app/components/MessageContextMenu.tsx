"use client";

import { useEffect, useRef, useState } from "react";
import type { Message, ReplyTarget } from "../hooks/useMessages";

interface Props {
  msg: Message;
  x: number;
  y: number;
  onClose: () => void;
  onReply: (target: ReplyTarget) => void;
  onForward: (msg: Message) => void;
  onReact: (msg: Message, emoji: string) => Promise<void>;
  onToggleStar: (msgId: string) => Promise<void>;
  onDelete: (msg: Message) => Promise<void>;
  onPreview: (msg: Message) => void;
}

const QUICK_REACTIONS = ["👍", "❤️", "😂", "😮", "😢", "🙏"];

export function MessageContextMenu({
  msg, x, y, onClose, onReply, onForward, onReact, onToggleStar, onDelete, onPreview,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [showReactions, setShowReactions] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    function handleEsc(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    const timer = setTimeout(() => {
      document.addEventListener("mousedown", handleClickOutside);
      document.addEventListener("keydown", handleEsc);
    }, 0);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEsc);
    };
  }, [onClose]);

  // Keep menu inside viewport
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    if (rect.right > vw) el.style.left = `${vw - rect.width - 8}px`;
    if (rect.bottom > vh) el.style.top = `${vh - rect.height - 8}px`;
  }, [x, y, showReactions]);

  const copyableText = msg.text || msg.mediaCaption || msg.filename || "";
  const hasCopyable = copyableText.length > 0;
  const hasMedia = !!msg.mediaUrl;

  function handleReply() {
    onReply({
      id: msg.id,
      senderName: msg.fromMe ? "Você" : msg.senderName,
      text: msg.text,
      fromMe: msg.fromMe,
    });
    onClose();
  }

  async function handleCopy() {
    if (!copyableText) return;
    try {
      await navigator.clipboard.writeText(copyableText);
    } catch {}
    onClose();
  }

  function handleDownload() {
    if (!msg.mediaUrl) return;
    const a = document.createElement("a");
    a.href = msg.mediaUrl;
    a.download = msg.filename || `media-${msg.id}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    onClose();
  }

  function handleForward() {
    onForward(msg);
    onClose();
  }

  async function handleReaction(emoji: string) {
    if (busy) return;
    setBusy(true);
    try {
      await onReact(msg, emoji);
    } catch (err) {
      alert(`Falha ao reagir: ${(err as Error).message}`);
    }
    setBusy(false);
    onClose();
  }

  async function handleToggleStar() {
    try {
      await onToggleStar(msg.id);
    } catch {}
    onClose();
  }

  async function handleDelete() {
    if (!confirm("Excluir esta mensagem para todos? Isso não pode ser desfeito.")) return;
    setBusy(true);
    try {
      await onDelete(msg);
    } catch (err) {
      alert(`Falha ao excluir: ${(err as Error).message}`);
    }
    setBusy(false);
    onClose();
  }

  if (showReactions) {
    return (
      <div
        ref={ref}
        className="wa-ctx-menu wa-ctx-reactions"
        style={{ left: x, top: y }}
        onClick={(e) => e.stopPropagation()}
      >
        {QUICK_REACTIONS.map((emoji) => (
          <button
            key={emoji}
            className="wa-ctx-emoji"
            onClick={() => handleReaction(emoji)}
            disabled={busy}
          >
            {emoji}
          </button>
        ))}
      </div>
    );
  }

  return (
    <div
      ref={ref}
      className="wa-ctx-menu"
      style={{ left: x, top: y }}
      onClick={(e) => e.stopPropagation()}
    >
      <button className="wa-ctx-item" onClick={() => { onPreview(msg); onClose(); }}>
        <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
          <path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/>
        </svg>
        Preview do conteúdo
      </button>

      <button className="wa-ctx-item" onClick={handleReply}>
        <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
          <path d="M10 9V5l-7 7 7 7v-4.1c5 0 8.5 1.6 11 5.1-1-5-4-10-11-11z"/>
        </svg>
        Responder
      </button>

      <button
        className="wa-ctx-item"
        onClick={handleCopy}
        disabled={!hasCopyable}
        title={hasCopyable ? "" : "Nada para copiar"}
      >
        <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
          <path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/>
        </svg>
        Copiar
      </button>

      <button
        className="wa-ctx-item"
        onClick={handleForward}
        disabled={!hasCopyable && !hasMedia}
      >
        <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
          <path d="M12 8V4l8 8-8 8v-4H4V8z"/>
        </svg>
        Encaminhar
      </button>

      <button
        className="wa-ctx-item"
        onClick={handleDownload}
        disabled={!hasMedia}
        title={hasMedia ? "" : "Sem mídia para baixar"}
      >
        <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
          <path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/>
        </svg>
        Baixar arquivo
      </button>

      <div className="wa-ctx-sep" />

      <button className="wa-ctx-item" onClick={() => setShowReactions(true)}>
        <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
          <path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm3.5-9c.83 0 1.5-.67 1.5-1.5S16.33 8 15.5 8 14 8.67 14 9.5s.67 1.5 1.5 1.5zm-7 0c.83 0 1.5-.67 1.5-1.5S9.33 8 8.5 8 7 8.67 7 9.5 7.67 11 8.5 11zm3.5 6.5c2.33 0 4.31-1.46 5.11-3.5H6.89c.8 2.04 2.78 3.5 5.11 3.5z"/>
        </svg>
        Reagir
      </button>

      <button className="wa-ctx-item" onClick={handleToggleStar}>
        <svg viewBox="0 0 24 24" width="18" height="18" fill={msg.starred ? "#f59e0b" : "currentColor"}>
          <path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/>
        </svg>
        {msg.starred ? "Remover estrela" : "Marcar com estrela"}
      </button>

      <div className="wa-ctx-sep" />

      {msg.fromMe ? (
        <button className="wa-ctx-item danger" onClick={handleDelete} disabled={busy}>
          <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
            <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>
          </svg>
          Excluir para todos
        </button>
      ) : (
        <button className="wa-ctx-item disabled" disabled title="Só posso excluir mensagens que você enviou">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
            <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>
          </svg>
          Excluir mensagem
        </button>
      )}
    </div>
  );
}
