"use client";

import { useMemo, useState } from "react";
import type { Chat } from "../hooks/useChats";
import type { Message } from "../hooks/useMessages";
import { formatChatName, getInitials, avatarColor } from "../lib/formatters";

interface Props {
  open: boolean;
  onClose: () => void;
  message: Message | null;
  chats: Chat[];
  onSend: (chatJid: string, msg: Message) => Promise<void>;
}

export function ForwardPickerModal({ open, onClose, message, chats, onSend }: Props) {
  const [search, setSearch] = useState("");
  const [sending, setSending] = useState(false);
  const [sendingTo, setSendingTo] = useState<string | null>(null);
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
    const hasContent =
      !!(message.text && message.text.trim()) ||
      !!message.mediaUrl ||
      !!message.mediaCaption;
    if (!hasContent) {
      setError("Mensagem vazia, nada para encaminhar.");
      return;
    }
    setSending(true);
    setSendingTo(chat.jid);
    setError(null);
    try {
      await onSend(chat.jid, message);
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSending(false);
      setSendingTo(null);
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
              return (
                <button
                  key={c.jid}
                  className="wa-contact-list-item"
                  onClick={() => handlePick(c)}
                  disabled={sending}
                >
                  <div className="wa-contact-list-avatar" style={{ padding: 0, overflow: "hidden" }}>
                    {c.profilePicUrl ? (
                      <img src={c.profilePicUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                    ) : (
                      <span className="wa-avatar-initials" style={{ backgroundColor: avatarColor(c.jid), width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: "14px", fontWeight: 500 }}>
                        {getInitials(displayName)}
                      </span>
                    )}
                  </div>
                  <div className="wa-contact-list-info">
                    <div className="wa-contact-list-name">{displayName}</div>
                    <div className="wa-contact-list-sub">
                      {sendingTo === c.jid
                        ? "Encaminhando..."
                        : c.isGroup
                        ? "Grupo"
                        : c.jid.split("@")[0]}
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
