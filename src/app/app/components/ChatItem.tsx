import { formatChatName, formatChatTime, getInitial } from "../lib/formatters";
import type { Chat } from "../hooks/useChats";

interface Props {
  chat: Chat;
  selected: boolean;
  onClick: () => void;
}

export function ChatItem({ chat, selected, onClick }: Props) {
  const displayName = formatChatName(chat.jid, chat.name);

  return (
    <div className={`wa-chat-item ${selected ? "active" : ""}`} onClick={onClick}>
      <div className={`wa-avatar ${chat.isGroup ? "group" : ""}`}>
        {chat.profilePicUrl ? (
          <img src={chat.profilePicUrl} alt="" />
        ) : (
          getInitial(displayName)
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
            {chat.lastMessage || ""}
          </span>
          {chat.msgCount > 0 && !chat.lastMessage && (
            <span className="wa-chat-count">{chat.msgCount}</span>
          )}
        </div>
      </div>
    </div>
  );
}
