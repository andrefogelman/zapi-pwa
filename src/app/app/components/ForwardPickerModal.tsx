"use client";

import { useMemo, useState } from "react";
import type { Chat } from "../hooks/useChats";
import type { Message } from "../hooks/useMessages";
import { formatChatName, generateAvatarUrl } from "../lib/formatters";

interface Props {
  open: boolean;
  onClose: () => void;
  message: Message | null;
  chats: Chat[];
  onSend: (chatJid: string, text: string) => Promise<void>;
}

export function ForwardPickerModal({ open, onClose, message, chats, onSend }: Props) {
  const [search, setSearch] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const filtered = useMemo(() => {
    if (!search.trim()) return chats;
    const q = search.trim().toLowerCase();
    return chats.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.jid.toLowerCase().includes(q)
    );
  }, [chats, search]);

  async function handlePick(chat: Chat) {
    if (!message || sending) return;
    const text = message.text || message.mediaCaption || "";
    if (!text.trim()) {
      setError("Não é possível encaminhar — mensagem sem texto. Mídia ainda não suportada.");
      return;
    }
    setSending(true);
    setError(null);
    try {
      await onSend(chat.jid, text);
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSending(false);
    }
  }

  if (!open || !message) return null;

  return (
    <div className="wa-modal-overlay" onClick={onClose}>
      <div className="wa-modal wa-modal-lg" onClick={(e) => e.stopPropagation()}>
        <div className="wa-modal-header">
          <div className="wa-modal-title">Encaminhar para...</div>
          <button className="wa-modal-close" onClick={onClose}>✕</button>
        </div>

        <div className="wa-modal-body">
          <input
            className="wa-modal-search"
            placeholder="Buscar conversa..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            autoFocus
          />
          {error && <div className="wa-modal-error">{error}</div>}
          <div className="wa-contact-list">
            {filtered.slice(0, 50).map((c) => {
              const displayName = formatChatName(c.jid, c.name);
              const avatarUrl = c.profilePicUrl || generateAvatarUrl(c.jid, c.isGroup);
              return (
                <button
                  key={c.jid}
                  className="wa-contact-list-item"
                  onClick={() => handlePick(c)}
                  disabled={sending}
                >
                  <div className="wa-contact-list-avatar" style={{ padding: 0, overflow: "hidden" }}>
                    <img src={avatarUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                  </div>
                  <div className="wa-contact-list-info">
                    <div className="wa-contact-list-name">{displayName}</div>
                    <div className="wa-contact-list-sub">
                      {c.isGroup ? "Grupo" : c.jid.split("@")[0]}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
