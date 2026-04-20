"use client";

import { useEffect, useRef } from "react";
import type { Chat } from "../hooks/useChats";

export type ChatAction =
  | "markUnread"
  | "markRead"
  | "pin"
  | "unpin"
  | "archive"
  | "clear"
  | "delete";

interface Props {
  chat: Chat;
  x: number;
  y: number;
  onClose: () => void;
  onAction: (action: ChatAction, chat: Chat) => void;
}

interface Item {
  key: ChatAction;
  label: string;
  icon: string;
  destructive?: boolean;
}

export function ChatContextMenu({ chat, x, y, onClose, onAction }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("click", onClick);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("click", onClick);
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const items: Item[] = [
    chat.isUnread || chat.manualUnread
      ? { key: "markRead", label: "Marcar como lida", icon: "📖" }
      : { key: "markUnread", label: "Marcar como não lida", icon: "🔖" },
    chat.pinned
      ? { key: "unpin", label: "Desafixar", icon: "📌" }
      : { key: "pin", label: "Fixar no topo", icon: "📌" },
    { key: "archive", label: "Arquivar", icon: "🗄️" },
    { key: "clear", label: "Limpar conversa", icon: "🧹", destructive: true },
    { key: "delete", label: "Apagar conversa", icon: "🗑️", destructive: true },
  ];

  // Clamp so menu stays on screen. 220px wide × ~260px tall.
  const width = 220;
  const height = 260;
  const left = Math.min(x, window.innerWidth - width - 8);
  const top = Math.min(y, window.innerHeight - height - 8);

  return (
    <div
      ref={ref}
      style={{
        position: "fixed",
        left,
        top,
        zIndex: 9999,
        background: "#233138",
        border: "1px solid rgba(255,255,255,0.08)",
        borderRadius: 8,
        boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
        width,
        padding: "6px 0",
        fontSize: 14,
        color: "#e9edef",
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.map((it, i) => (
        <div key={it.key}>
          {i === 3 && (
            <div style={{ height: 1, background: "rgba(255,255,255,0.06)", margin: "4px 0" }} />
          )}
          <button
            onClick={() => {
              onAction(it.key, chat);
              onClose();
            }}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              width: "100%",
              background: "transparent",
              border: "none",
              color: it.destructive ? "#ef4444" : "#e9edef",
              textAlign: "left",
              padding: "8px 16px",
              cursor: "pointer",
              fontSize: 13,
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.05)")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
          >
            <span style={{ width: 16, textAlign: "center" }}>{it.icon}</span>
            <span>{it.label}</span>
          </button>
        </div>
      ))}
    </div>
  );
}
