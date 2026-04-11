"use client";

import { useEffect, useRef } from "react";
import type { Message, ReplyTarget } from "../hooks/useMessages";

interface Props {
  msg: Message;
  x: number;
  y: number;
  onClose: () => void;
  onReply: (target: ReplyTarget) => void;
  onForward: (msg: Message) => void;
}

export function MessageContextMenu({ msg, x, y, onClose, onReply, onForward }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    function handleEsc(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    // Delay to avoid the same click that opened it also closing it
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
  }, [x, y]);

  const hasText = !!msg.text;
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
    if (!msg.text) return;
    try {
      await navigator.clipboard.writeText(msg.text);
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

  return (
    <div
      ref={ref}
      className="wa-ctx-menu"
      style={{ left: x, top: y }}
      onClick={(e) => e.stopPropagation()}
    >
      <button className="wa-ctx-item" onClick={handleReply}>
        <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
          <path d="M10 9V5l-7 7 7 7v-4.1c5 0 8.5 1.6 11 5.1-1-5-4-10-11-11z"/>
        </svg>
        Responder
      </button>

      <button
        className="wa-ctx-item"
        onClick={handleCopy}
        disabled={!hasText}
        title={hasText ? "" : "Apenas mensagens de texto"}
      >
        <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
          <path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/>
        </svg>
        Copiar
      </button>

      <button
        className="wa-ctx-item"
        onClick={handleForward}
        disabled={!hasText && !hasMedia}
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

      <button className="wa-ctx-item disabled" disabled title="Em breve">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
          <path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm3.5-9c.83 0 1.5-.67 1.5-1.5S16.33 8 15.5 8 14 8.67 14 9.5s.67 1.5 1.5 1.5zm-7 0c.83 0 1.5-.67 1.5-1.5S9.33 8 8.5 8 7 8.67 7 9.5 7.67 11 8.5 11zm3.5 6.5c2.33 0 4.31-1.46 5.11-3.5H6.89c.8 2.04 2.78 3.5 5.11 3.5z"/>
        </svg>
        Reagir
      </button>

      <button className="wa-ctx-item disabled" disabled title="Em breve">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
          <path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/>
        </svg>
        Marcar com estrela
      </button>

      <div className="wa-ctx-sep" />

      <button className="wa-ctx-item danger disabled" disabled title="Em breve">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
          <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>
        </svg>
        Excluir mensagem
      </button>
    </div>
  );
}
