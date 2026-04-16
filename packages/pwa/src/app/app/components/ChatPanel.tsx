import { useEffect, useRef, useState } from "react";
import { MessageBubble } from "./MessageBubble";
import { MessageInput } from "./MessageInput";
import { DaySeparator } from "./DaySeparator";
import { formatChatName, formatDayLabel, getInitials, avatarColor } from "../lib/formatters";
import type { Chat } from "../hooks/useChats";
import type { Message, ReplyTarget } from "../hooks/useMessages";

interface Props {
  chat: Chat;
  messages: Message[];
  loading: boolean;
  loadingOlder: boolean;
  hasOlder: boolean;
  sending: boolean;
  replyTarget: ReplyTarget | null;
  onLoadOlder: () => void;
  onSend: (text: string, quote?: ReplyTarget | null) => void;
  onSendFile: (file: File, caption?: string) => Promise<void>;
  onReply: (target: ReplyTarget) => void;
  onForward: (msg: Message) => void;
  onReact: (msg: Message, emoji: string) => Promise<void>;
  onToggleStar: (msgId: string) => Promise<void>;
  onDelete: (msg: Message) => Promise<void>;
  onCancelReply: () => void;
  onBack: () => void;
  onOpenSummary: () => void;
  onOpenSchedule: () => void;
  onLinkToTask: () => void;
  onLinkMsgToTask: (msg: Message) => void;
  taskCount: number;
  initialLoad: React.MutableRefObject<boolean>;
}

export function ChatPanel({
  chat, messages, loading, loadingOlder, hasOlder, sending,
  replyTarget, onLoadOlder, onSend, onSendFile, onReply, onForward,
  onReact, onToggleStar, onDelete,
  onCancelReply, onBack, onOpenSummary, onOpenSchedule, onLinkToTask, onLinkMsgToTask, taskCount, initialLoad,
}: Props) {
  const [input, setInput] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const displayName = formatChatName(chat.jid, chat.name);

  useEffect(() => {
    if (initialLoad.current && messages.length > 0) {
      bottomRef.current?.scrollIntoView({ behavior: "instant" });
      initialLoad.current = false;
    }
  }, [messages]);

  function handleScroll() {
    const el = containerRef.current;
    if (el && el.scrollTop < 80 && !loadingOlder && hasOlder && messages.length > 0) {
      const prevHeight = el.scrollHeight;
      onLoadOlder();
      requestAnimationFrame(() => {
        if (el) el.scrollTop = el.scrollHeight - prevHeight;
      });
    }
  }

  function handleSend() {
    if (!input.trim()) return;
    onSend(input, replyTarget);
    setInput("");
    setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
  }

  // Group messages by day
  const groups: { label: string; key: string; msgs: Message[] }[] = [];
  for (const msg of messages) {
    const d = new Date(msg.timestamp < 1e12 ? msg.timestamp * 1000 : msg.timestamp);
    const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    const last = groups[groups.length - 1];
    if (last && last.key === key) {
      last.msgs.push(msg);
    } else {
      groups.push({ label: formatDayLabel(msg.timestamp), key, msgs: [msg] });
    }
  }

  return (
    <div className="wa-chat-panel">
      <div className="wa-panel-header">
        <button className="wa-back-btn" onClick={onBack}>
          <svg viewBox="0 0 24 24" width="24" height="24" fill="#aebac1"><path d="M12 4l1.4 1.4L7.8 11H20v2H7.8l5.6 5.6L12 20l-8-8z"/></svg>
        </button>
        <div className={`wa-avatar sm ${chat.isGroup ? "group" : ""}`}>
          {chat.profilePicUrl ? (
            <img src={chat.profilePicUrl} alt="" />
          ) : (
            <span className="wa-avatar-initials" style={{ backgroundColor: avatarColor(chat.jid) }}>
              {getInitials(displayName)}
            </span>
          )}
        </div>
        <div className="wa-panel-header-info">
          <div className="wa-panel-header-name">{displayName}</div>
          <div className="wa-panel-header-sub">
            {chat.isGroup ? `${chat.msgCount} mensagens` : chat.jid.split("@")[0]}
          </div>
        </div>
        <div className="wa-panel-actions">
          <button
            className="wa-panel-action"
            onClick={onLinkToTask}
            title="Vincular a tarefa"
            style={{ position: "relative" }}
          >
            <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
              <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-2 10h-4v4h-2v-4H7v-2h4V7h2v4h4v2z"/>
            </svg>
            {taskCount > 0 && (
              <span style={{
                position: "absolute", top: -2, right: -2,
                background: "#00a884", color: "#111b21",
                fontSize: 9, fontWeight: 700,
                width: 16, height: 16, borderRadius: "50%",
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>
                {taskCount}
              </span>
            )}
          </button>
          <button
            className="wa-panel-action"
            onClick={onOpenSummary}
            title="Resumir conversa"
          >
            <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
              <path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"/>
            </svg>
          </button>
          <button
            className="wa-panel-action"
            onClick={onOpenSchedule}
            title="Agendar mensagem"
          >
            <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
              <path d="M15 13h1.5v2.82l2.44 1.41-.75 1.3L15 16.69V13zm4-5H5v11h4.67c-.43-.91-.67-1.93-.67-3 0-3.87 3.13-7 7-7 1.07 0 2.09.24 3 .67V8zM5 21c-1.1 0-2-.9-2-2V5c0-1.1.9-2 2-2h1V1h2v2h8V1h2v2h1c1.1 0 2 .9 2 2v6.1c1.24 1.26 2 2.99 2 4.9 0 3.87-3.13 7-7 7-1.91 0-3.64-.76-4.9-2H5zm11-4.85C18.3 16.15 20 14.44 20 12.15c0-2.29-1.7-4-4-4s-4 1.71-4 4 1.7 4 4 4z"/>
            </svg>
          </button>
        </div>
      </div>

      <div className="wa-messages" ref={containerRef} onScroll={handleScroll}>
        {loadingOlder && <div className="wa-loading sm">Carregando...</div>}
        {loading && <div className="wa-loading">Carregando mensagens...</div>}
        {groups.map((g) => (
          <div key={g.key}>
            <DaySeparator label={g.label} />
            {g.msgs.map((msg) => (
              <MessageBubble
                key={msg.id}
                msg={msg}
                isGroup={chat.isGroup}
                onReply={onReply}
                onForward={onForward}
                onReact={onReact}
                onToggleStar={onToggleStar}
                onDelete={onDelete}
                onLinkToTask={onLinkMsgToTask}
              />
            ))}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      <MessageInput
        value={input}
        onChange={setInput}
        onSend={handleSend}
        onSendFile={onSendFile}
        sending={sending}
        replyTarget={replyTarget}
        onCancelReply={onCancelReply}
      />
    </div>
  );
}
