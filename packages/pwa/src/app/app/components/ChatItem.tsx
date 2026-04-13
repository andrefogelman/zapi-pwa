import { useState } from "react";
import { formatChatName, formatChatTime, getInitials, avatarColor } from "../lib/formatters";
import type { Chat } from "../hooks/useChats";

interface Props {
  chat: Chat;
  selected: boolean;
  onClick: () => void;
}

export function ChatItem({ chat, selected, onClick }: Props) {
  const [imgError, setImgError] = useState(false);
  const displayName = formatChatName(chat.jid, chat.name);
  const initials = getInitials(displayName);
  const bgColor = avatarColor(chat.jid);
  const hasAvatar = chat.profilePicUrl && !imgError;

  const classes = [
    "wa-chat-item",
    selected && "active",
    chat.isUnread && "has-unread",
  ].filter(Boolean).join(" ");

  return (
    <div className={classes} onClick={onClick}>
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
          <span className="wa-chat-name">{displayName}</span>
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
