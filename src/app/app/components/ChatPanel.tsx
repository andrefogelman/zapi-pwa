import { useEffect, useRef, useState } from "react";
import { MessageBubble } from "./MessageBubble";
import { MessageInput } from "./MessageInput";
import { DaySeparator } from "./DaySeparator";
import { formatChatName, formatDayLabel, generateAvatarUrl } from "../lib/formatters";
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
  onSend: (text: string) => void;
  onSendFile: (file: File, caption?: string) => Promise<void>;
  onReply: (target: ReplyTarget) => void;
  onForward: (msg: Message) => void;
  onCancelReply: () => void;
  onBack: () => void;
  initialLoad: React.MutableRefObject<boolean>;
}

export function ChatPanel({
  chat, messages, loading, loadingOlder, hasOlder, sending,
  replyTarget, onLoadOlder, onSend, onSendFile, onReply, onForward,
  onCancelReply, onBack, initialLoad,
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
    onSend(input);
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
          <img
            src={chat.profilePicUrl || generateAvatarUrl(chat.jid, chat.isGroup)}
            alt=""
          />
        </div>
        <div className="wa-panel-header-info">
          <div className="wa-panel-header-name">{displayName}</div>
          <div className="wa-panel-header-sub">
            {chat.isGroup ? `${chat.msgCount} mensagens` : chat.jid.split("@")[0]}
          </div>
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
