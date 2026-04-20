"use client";

import { memo, useRef, useState } from "react";
import { formatChatName, formatChatTime, getInitials, avatarColor } from "../lib/formatters";
import type { Chat } from "../hooks/useChats";

interface Props {
  chat: Chat;
  selected: boolean;
  onClick: () => void;
  onContextMenu?: (chat: Chat, x: number, y: number) => void;
}

const LONG_PRESS_MS = 450;

function ChatItemImpl({ chat, selected, onClick, onContextMenu }: Props) {
  const [imgError, setImgError] = useState(false);
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const suppressClick = useRef(false);
  const displayName = formatChatName(chat.jid, chat.name);
  const initials = getInitials(displayName);
  const bgColor = avatarColor(chat.jid);
  const hasAvatar = chat.profilePicUrl && !imgError;

  const classes = [
    "wa-chat-item",
    selected && "active",
    chat.isUnread && "has-unread",
  ].filter(Boolean).join(" ");

  function handleContextMenu(e: React.MouseEvent) {
    if (!onContextMenu) return;
    e.preventDefault();
    onContextMenu(chat, e.clientX, e.clientY);
  }

  function handleTouchStart(e: React.TouchEvent) {
    if (!onContextMenu) return;
    const t = e.touches[0];
    pressTimer.current = setTimeout(() => {
      suppressClick.current = true;
      onContextMenu(chat, t.clientX, t.clientY);
    }, LONG_PRESS_MS);
  }
  function cancelPress() {
    if (pressTimer.current) {
      clearTimeout(pressTimer.current);
      pressTimer.current = null;
    }
  }
  function handleClick() {
    if (suppressClick.current) {
      suppressClick.current = false;
      return;
    }
    onClick();
  }

  return (
    <div
      className={classes}
      onClick={handleClick}
      onContextMenu={handleContextMenu}
      onTouchStart={handleTouchStart}
      onTouchEnd={cancelPress}
      onTouchMove={cancelPress}
      onTouchCancel={cancelPress}
    >
      <div className={`wa-avatar ${chat.isGroup ? "group" : ""}`}>
        {hasAvatar ? (
          <img src={chat.profilePicUrl!} alt="" onError={() => setImgError(true)} />
        ) : (
          <span className="wa-avatar-initials" style={{ backgroundColor: bgColor }}>
            {initials}
          </span>
        )}
      </div>
      <div className="wa-chat-body">
        <div className="wa-chat-row">
          <span className="wa-chat-name">
            {chat.pinned && <span style={{ marginRight: 4, color: "#8696a0" }}>📌</span>}
            {displayName}
            {chat.mutedUntil > 0 && chat.mutedUntil > Math.floor(Date.now() / 1000) && (
              <span style={{ marginLeft: 6, color: "#8696a0", fontSize: 13 }} title="Silenciado">🔇</span>
            )}
            {chat.blocked && (
              <span style={{ marginLeft: 6, color: "#ef4444", fontSize: 12 }} title="Bloqueado">🚫</span>
            )}
          </span>
          <span className="wa-chat-time">{formatChatTime(chat.lastTs)}</span>
        </div>
        <div className="wa-chat-row">
          <span className="wa-chat-preview">
            {chat.lastSender && chat.isGroup ? `${chat.lastSender}: ` : ""}
            {chat.lastMessage || "\u00A0"}
          </span>
          {chat.isUnread && (
            <span className="wa-chat-unread-dot" />
          )}
        </div>
      </div>
    </div>
  );
}

// 800+ items — memoize. Re-render only when anything user-visible on this row
// changes, or selection toggles.
export const ChatItem = memo(ChatItemImpl, (prev, next) => {
  if (prev.selected !== next.selected) return false;
  const a = prev.chat;
  const b = next.chat;
  return (
    a.jid === b.jid &&
    a.name === b.name &&
    a.lastTs === b.lastTs &&
    a.lastMessage === b.lastMessage &&
    a.lastSender === b.lastSender &&
    a.isUnread === b.isUnread &&
    a.pinned === b.pinned &&
    a.blocked === b.blocked &&
    a.mutedUntil === b.mutedUntil &&
    a.hasAvatar === b.hasAvatar &&
    a.profilePicUrl === b.profilePicUrl
  );
});
