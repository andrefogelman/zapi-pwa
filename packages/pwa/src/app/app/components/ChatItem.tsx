import { formatChatName, formatChatTime, getInitials, avatarColor } from "../lib/formatters";
import type { Chat } from "../hooks/useChats";

interface Props {
  chat: Chat;
  selected: boolean;
  onClick: () => void;
}

export function ChatItem({ chat, selected, onClick }: Props) {
  const displayName = formatChatName(chat.jid, chat.name);
  const initials = getInitials(displayName);
  const bgColor = avatarColor(chat.jid);
  const hasUnread = chat.msgCount > 0;

  const classes = [
    "wa-chat-item",
    selected && "active",
    hasUnread && "has-unread",
  ].filter(Boolean).join(" ");

  return (
    <div className={classes} onClick={onClick}>
      <div className={`wa-avatar ${chat.isGroup ? "group" : ""}`}>
        {chat.profilePicUrl ? (
          <img src={chat.profilePicUrl} alt="" />
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
          {hasUnread && (
            <span className="wa-chat-count">{chat.msgCount}</span>
          )}
        </div>
      </div>
    </div>
  );
}
