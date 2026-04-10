"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useAuth } from "@/lib/use-auth";

interface Instance {
  id: string;
  name: string;
  status: string;
  provider: string;
  waclaw_session_id: string | null;
}

interface Chat {
  jid: string;
  name: string;
  isGroup: boolean;
  lastTs: number;
  lastMessage: string | null;
  lastSender: string | null;
  msgCount: number;
  unread: number;
}

interface Message {
  id: string;
  text: string | null;
  type: string;
  fromMe: boolean;
  senderName: string | null;
  senderJid: string | null;
  chatName: string | null;
  timestamp: number;
  mediaCaption: string | null;
  filename: string | null;
  mimeType: string | null;
}

export default function AppMain() {
  const { session, signOut } = useAuth();
  const [instance, setInstance] = useState<Instance | null>(null);
  const [instances, setInstances] = useState<Instance[]>([]);
  const [chats, setChats] = useState<Chat[]>([]);
  const [filteredChats, setFilteredChats] = useState<Chat[]>([]);
  const [search, setSearch] = useState("");
  const [selectedChat, setSelectedChat] = useState<Chat | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [msgInput, setMsgInput] = useState("");
  const [sending, setSending] = useState(false);
  const [loadingChats, setLoadingChats] = useState(true);
  const [loadingMsgs, setLoadingMsgs] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const headers: Record<string, string> = {
    Authorization: `Bearer ${session?.access_token}`,
    "Content-Type": "application/json",
  };

  // Load instances
  useEffect(() => {
    if (!session) return;
    fetch("/api/instances", { headers }).then(r => r.json()).then((data: Instance[]) => {
      setInstances(data);
      const waclaw = data.find(i => i.provider === "waclaw" && i.waclaw_session_id);
      const connected = data.find(i => i.status === "connected");
      setInstance(waclaw || connected || data[0] || null);
    });
  }, [session]);

  // Load chats when instance changes
  useEffect(() => {
    if (!instance) return;
    loadChats();
  }, [instance]);

  // Filter chats on search
  useEffect(() => {
    if (!search) {
      setFilteredChats(chats);
    } else {
      const q = search.toLowerCase();
      setFilteredChats(chats.filter(c => c.name.toLowerCase().includes(q) || c.jid.includes(q)));
    }
  }, [search, chats]);

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function loadChats() {
    setLoadingChats(true);
    if (instance?.provider === "waclaw" && instance.waclaw_session_id) {
      const res = await fetch(`/api/waclaw/sessions/${instance.waclaw_session_id}/chats`, { headers });
      if (res.ok) {
        const data = await res.json();
        setChats(data.map((c: Record<string, unknown>) => ({
          jid: c.jid as string,
          name: (c.name as string) || (c.jid as string).split("@")[0],
          isGroup: c.isGroup as boolean,
          lastTs: c.lastTs as number,
          lastMessage: c.lastMessage as string | null,
          lastSender: c.lastSender as string | null,
          msgCount: c.msgCount as number || 0,
          unread: 0,
        })));
      }
    } else if (instance) {
      const res = await fetch(`/api/chats?instance_id=${instance.id}&pageSize=200`, { headers });
      if (res.ok) {
        const data = await res.json();
        setChats(data.map((c: Record<string, unknown>) => ({
          jid: c.phone as string,
          name: (c.name as string) || (c.phone as string),
          isGroup: c.isGroup as boolean,
          lastTs: c.lastMessageTime as number,
          lastMessage: null,
          lastSender: null,
          msgCount: 0,
          unread: (c.unread as number) || 0,
        })));
      }
    }
    setLoadingChats(false);
  }

  async function openChat(chat: Chat) {
    setSelectedChat(chat);
    setLoadingMsgs(true);
    setMessages([]);

    if (instance?.provider === "waclaw" && instance.waclaw_session_id) {
      const res = await fetch(
        `/api/waclaw/sessions/${instance.waclaw_session_id}/messages/${encodeURIComponent(chat.jid)}?limit=100`,
        { headers }
      );
      if (res.ok) {
        setMessages(await res.json());
      }
    }
    setLoadingMsgs(false);
  }

  async function sendMessage() {
    if (!msgInput.trim() || !selectedChat || !instance || sending) return;
    setSending(true);

    if (instance.provider === "waclaw" && instance.waclaw_session_id) {
      await fetch(`/api/waclaw/sessions/${instance.waclaw_session_id}/send`, {
        method: "POST",
        headers,
        body: JSON.stringify({ to: selectedChat.jid, message: msgInput }),
      });
    }

    // Optimistic: add message locally
    setMessages(prev => [...prev, {
      id: `local-${Date.now()}`,
      text: msgInput,
      type: "text",
      fromMe: true,
      senderName: null,
      senderJid: null,
      chatName: null,
      timestamp: Date.now(),
      mediaCaption: null,
      filename: null,
      mimeType: null,
    }]);

    setMsgInput("");
    setSending(false);
  }

  function formatChatTime(ts: number) {
    if (!ts) return "";
    const d = new Date(ts);
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const msgDay = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const diffDays = Math.floor((today.getTime() - msgDay.getTime()) / 86400000);

    if (diffDays === 0) return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
    if (diffDays === 1) return "Ontem";
    if (diffDays < 7) return d.toLocaleDateString("pt-BR", { weekday: "short" });
    return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit" });
  }

  function formatMsgTime(ts: number) {
    return new Date(ts).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  }

  function formatDayLabel(ts: number) {
    const d = new Date(ts);
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const msgDay = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const diffDays = Math.floor((today.getTime() - msgDay.getTime()) / 86400000);

    if (diffDays === 0) return "HOJE";
    if (diffDays === 1) return "ONTEM";
    return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" }).toUpperCase();
  }

  // Group messages by day
  function getMessageDays(): { label: string; messages: Message[] }[] {
    const groups: { label: string; date: string; messages: Message[] }[] = [];
    for (const msg of messages) {
      const d = new Date(msg.timestamp);
      const dateKey = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
      const last = groups[groups.length - 1];
      if (last && last.date === dateKey) {
        last.messages.push(msg);
      } else {
        groups.push({ label: formatDayLabel(msg.timestamp), date: dateKey, messages: [msg] });
      }
    }
    return groups;
  }

  function getInitial(name: string) {
    return name.charAt(0).toUpperCase();
  }

  function getMsgTypeIcon(type: string) {
    if (type === "audio" || type === "ptt") return "🎵";
    if (type === "image") return "📷";
    if (type === "video") return "🎥";
    if (type === "document") return "📄";
    if (type === "sticker") return "🏷️";
    return "";
  }

  const chatOpen = !!selectedChat;

  return (
    <div className={`wa-app ${chatOpen ? "chat-open" : ""}`}>
      {/* ══════ SIDEBAR ══════ */}
      <div className="wa-sidebar">
        <div className="wa-sidebar-header">
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div className="wa-avatar" style={{ width: 40, height: 40, fontSize: 14 }}>
              {session?.user?.email?.charAt(0).toUpperCase() || "U"}
            </div>
            <div>
              <div style={{ fontSize: 14, fontWeight: 500 }}>Transcritor</div>
              {instance && (
                <div style={{ fontSize: 11, color: "var(--wa-text-light)" }}>
                  {instance.provider === "waclaw" ? "WaClaw" : "Z-API"} · {chats.length} conversas
                </div>
              )}
            </div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            {instances.length > 1 && (
              <select
                value={instance?.id || ""}
                onChange={e => setInstance(instances.find(i => i.id === e.target.value) || null)}
                style={{ padding: "4px 8px", borderRadius: 4, border: "1px solid var(--wa-border)", fontSize: 12, background: "#fff" }}
              >
                {instances.map(i => (
                  <option key={i.id} value={i.id}>{i.name} ({i.provider})</option>
                ))}
              </select>
            )}
            <button
              onClick={() => { signOut(); window.location.href = "/login"; }}
              style={{ padding: "4px 12px", borderRadius: 4, border: "1px solid var(--wa-border)", background: "#fff", cursor: "pointer", fontSize: 12, color: "var(--wa-text-secondary)" }}
            >
              Sair
            </button>
          </div>
        </div>

        {/* Search */}
        <div className="wa-search">
          <input
            placeholder="Pesquisar ou começar uma nova conversa"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>

        {/* Chat list */}
        <div className="wa-chat-list">
          {loadingChats && (
            <div style={{ padding: "2rem", textAlign: "center", color: "var(--wa-text-light)" }}>
              Carregando conversas...
            </div>
          )}

          {filteredChats.map(chat => (
            <div
              key={chat.jid}
              className={`wa-chat-item ${selectedChat?.jid === chat.jid ? "selected" : ""}`}
              onClick={() => openChat(chat)}
            >
              <div className={`wa-avatar ${chat.isGroup ? "group" : ""}`}>
                {getInitial(chat.name)}
              </div>
              <div className="wa-chat-info">
                <div className="wa-chat-top">
                  <span className="wa-chat-name">{chat.name}</span>
                  <span className="wa-chat-time">{formatChatTime(chat.lastTs)}</span>
                </div>
                <div className="wa-chat-preview">
                  {chat.lastSender && !chat.lastMessage?.startsWith(chat.lastSender) && (
                    <span style={{ color: "var(--wa-text)" }}>{chat.lastSender}: </span>
                  )}
                  {chat.lastMessage || (chat.msgCount > 0 ? `${chat.msgCount} mensagens` : "")}
                </div>
              </div>
              {chat.unread > 0 && (
                <div className="wa-unread-badge">{chat.unread}</div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* ══════ MAIN CHAT AREA ══════ */}
      <div className="wa-main">
        {!selectedChat ? (
          <div className="wa-main-empty">
            <div style={{ fontSize: 64, opacity: 0.3 }}>💬</div>
            <div>Transcritor WhatsApp</div>
            <div style={{ fontSize: 13 }}>Selecione uma conversa para começar</div>
          </div>
        ) : (
          <>
            {/* Chat header */}
            <div className="wa-chat-header">
              {/* Back button (mobile) */}
              <button
                onClick={() => setSelectedChat(null)}
                style={{
                  display: "none", background: "none", border: "none", fontSize: 20, cursor: "pointer",
                  color: "var(--wa-text-secondary)", padding: "0 4px",
                }}
                className="wa-back-btn"
              >
                ←
              </button>
              <div className={`wa-avatar ${selectedChat.isGroup ? "group" : ""}`} style={{ width: 40, height: 40, fontSize: 16 }}>
                {getInitial(selectedChat.name)}
              </div>
              <div className="wa-chat-header-info">
                <div className="wa-chat-header-name">{selectedChat.name}</div>
                <div className="wa-chat-header-status">
                  {selectedChat.isGroup ? "Grupo" : selectedChat.jid.split("@")[0]}
                  {selectedChat.msgCount > 0 && ` · ${selectedChat.msgCount} mensagens`}
                </div>
              </div>
            </div>

            {/* Messages */}
            <div className="wa-messages">
              {loadingMsgs && (
                <div style={{ textAlign: "center", padding: "2rem", color: "var(--wa-text-light)" }}>
                  Carregando mensagens...
                </div>
              )}

              {getMessageDays().map(group => (
                <div key={group.label}>
                  <div className="wa-day-separator">
                    <span>{group.label}</span>
                  </div>
                  {group.messages.map(msg => (
                    <div key={msg.id} className={`wa-msg-row ${msg.fromMe ? "out" : "in"}`}>
                      <div className="wa-msg-bubble">
                        {!msg.fromMe && selectedChat.isGroup && msg.senderName && (
                          <div className="wa-msg-sender">{msg.senderName}</div>
                        )}

                        {(msg.type === "audio" || msg.type === "ptt") ? (
                          <div className="wa-msg-audio">
                            🎵 Áudio
                            {msg.filename && <span>({msg.filename})</span>}
                          </div>
                        ) : msg.type === "image" ? (
                          <div>
                            <div className="wa-msg-audio">📷 Imagem</div>
                            {msg.mediaCaption && <div className="wa-msg-text">{msg.mediaCaption}</div>}
                          </div>
                        ) : msg.type === "video" ? (
                          <div>
                            <div className="wa-msg-audio">🎥 Vídeo</div>
                            {msg.mediaCaption && <div className="wa-msg-text">{msg.mediaCaption}</div>}
                          </div>
                        ) : msg.type === "document" ? (
                          <div>
                            <div className="wa-msg-audio">📄 {msg.filename || "Documento"}</div>
                            {msg.mediaCaption && <div className="wa-msg-text">{msg.mediaCaption}</div>}
                          </div>
                        ) : msg.type === "sticker" ? (
                          <div className="wa-msg-audio">🏷️ Sticker</div>
                        ) : (
                          <div className="wa-msg-text">{msg.text}</div>
                        )}

                        <div className="wa-msg-meta">
                          <span className="wa-msg-time">{formatMsgTime(msg.timestamp)}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>

            {/* Input area */}
            <div className="wa-input-area">
              <input
                placeholder="Digite uma mensagem"
                value={msgInput}
                onChange={e => setMsgInput(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
              />
              <button
                className="wa-send-btn"
                onClick={sendMessage}
                disabled={!msgInput.trim() || sending}
              >
                ➤
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
