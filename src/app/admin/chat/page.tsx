"use client";

import { useEffect, useState, useRef, useCallback } from "react";

interface Chat {
  jid: string;
  phone: string;
  lid: string | null;
  name: string;
  isGroup: boolean;
  lastMessageTime: number;
  timeLabel: string;
  unread: number;
  pinned: boolean;
  muted: boolean;
  photo: string | null;
  lastMessage: { text: string; sender: string; fromMe: boolean; type: string } | null;
}

interface Message {
  sender: string;
  timestamp: string;
  text: string;
  type: string;
  fromMe: boolean;
  chatName: string;
}

interface ScheduledMsg {
  id: string;
  recipient: string;
  contact_name: string;
  content_type: string;
  content: string;
  scheduled_at: string;
  status: string;
  is_recurring: boolean;
  recurrence_pattern: string | null;
  error: string | null;
}

export default function ChatPage() {
  const [view, setView] = useState<"chat" | "scheduled">("chat");

  // Chat list
  const [chats, setChats] = useState<Chat[]>([]);
  const [chatSearch, setChatSearch] = useState("");
  const [chatsLoading, setChatsLoading] = useState(true);

  // Selected chat
  const [selectedChat, setSelectedChat] = useState<Chat | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loadingMsgs, setLoadingMsgs] = useState(false);

  // Send
  const [msgText, setMsgText] = useState("");
  const [sending, setSending] = useState(false);

  // Schedule
  const [showSchedule, setShowSchedule] = useState(false);
  const [schedDate, setSchedDate] = useState("");
  const [schedTime, setSchedTime] = useState("");
  const [isRecurring, setIsRecurring] = useState(false);
  const [recurPattern, setRecurPattern] = useState("daily");
  const [recurInterval, setRecurInterval] = useState(1);
  const [recurDays, setRecurDays] = useState<number[]>([]);
  const [recurEndDate, setRecurEndDate] = useState("");

  // Scheduled list
  const [scheduledMsgs, setScheduledMsgs] = useState<ScheduledMsg[]>([]);
  const [schedFilter, setSchedFilter] = useState("pending");

  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadChats();
  }, []);

  useEffect(() => {
    if (view === "scheduled") loadScheduled();
  }, [view, schedFilter]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function loadChats(query?: string) {
    try {
      setChatsLoading(true);
      const url = `/api/conversations?limit=200${query ? `&query=${encodeURIComponent(query)}` : ""}`;
      const res = await fetch(url);
      const data = await res.json();
      if (data.chats) {
        setChats(data.chats);
        loadDetails(data.chats);
      }
    } catch { /* ignore */ }
    finally { setChatsLoading(false); }
  }

  async function loadDetails(chatList: Chat[]) {
    const CHUNK = 15;
    for (let i = 0; i < chatList.length; i += CHUNK) {
      const chunk = chatList.slice(i, i + CHUNK);
      try {
        const res = await fetch("/api/conversations/details", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chatJids: chunk.map((c) => c.jid),
            phones: chunk.filter((c) => !c.isGroup).map((c) => c.phone),
          }),
        });
        if (!res.ok) continue;
        const data = await res.json();
        setChats((prev) => prev.map((c) => {
          const lm = data.lastMessages?.[c.jid];
          const photo = data.photos?.[c.phone];
          if (!lm && !photo) return c;
          return { ...c, lastMessage: lm || c.lastMessage, photo: photo || c.photo };
        }));
      } catch { /* continue */ }
    }
  }

  const selectChat = useCallback(async (chat: Chat) => {
    setSelectedChat(chat);
    setLoadingMsgs(true);
    setMessages([]);
    try {
      const res = await fetch(`/api/messages?chat=${encodeURIComponent(chat.jid)}&limit=100`);
      const data = await res.json();
      setMessages(data.messages || []);
    } catch { /* ignore */ }
    finally { setLoadingMsgs(false); }
  }, []);

  async function sendNow() {
    if (!selectedChat || !msgText.trim()) return;
    setSending(true);
    try {
      await fetch("/api/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recipient: selectedChat.jid, contentType: "text", content: msgText }),
      });
      setMsgText("");
      setTimeout(() => selectChat(selectedChat), 1500);
    } catch { /* ignore */ }
    finally { setSending(false); }
  }

  async function scheduleMsg() {
    if (!selectedChat || !msgText.trim() || !schedDate || !schedTime) return;
    const scheduledAt = new Date(`${schedDate}T${schedTime}:00-03:00`).toISOString();
    await fetch("/api/schedule", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        recipient: selectedChat.jid,
        contactName: selectedChat.name,
        chatJid: selectedChat.jid,
        contentType: "text",
        content: msgText,
        scheduledAt,
        isRecurring,
        recurrencePattern: isRecurring ? recurPattern : null,
        recurrenceInterval: isRecurring ? recurInterval : null,
        recurrenceDays: isRecurring && recurPattern === "weekly" ? recurDays : null,
        recurrenceEndDate: isRecurring && recurEndDate ? new Date(`${recurEndDate}T23:59:59-03:00`).toISOString() : null,
      }),
    });
    setMsgText("");
    setShowSchedule(false);
  }

  function applyPreset(preset: string) {
    const now = new Date();
    const brt = new Date(now.getTime() - 3 * 60 * 60 * 1000);
    let target: Date;
    switch (preset) {
      case "1h": target = new Date(brt.getTime() + 3600000); break;
      case "3h": target = new Date(brt.getTime() + 10800000); break;
      case "amanha9": target = new Date(brt); target.setDate(target.getDate() + 1); target.setHours(9, 0, 0, 0); break;
      case "amanha14": target = new Date(brt); target.setDate(target.getDate() + 1); target.setHours(14, 0, 0, 0); break;
      case "seg9": target = new Date(brt); { const d = target.getDay(); target.setDate(target.getDate() + (d === 0 ? 1 : d === 1 ? 7 : 8 - d)); } target.setHours(9, 0, 0, 0); break;
      default: return;
    }
    setSchedDate(target.toISOString().split("T")[0]);
    setSchedTime(target.toISOString().substring(11, 16));
  }

  async function loadScheduled() {
    try {
      const res = await fetch(`/api/scheduled${schedFilter ? `?status=${schedFilter}` : ""}`);
      const data = await res.json();
      setScheduledMsgs(data.messages || []);
    } catch { /* ignore */ }
  }

  async function cancelScheduled(id: string) {
    await fetch("/api/scheduled", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, status: "cancelled" }) });
    loadScheduled();
  }

  async function sendScheduledNow(id: string) {
    await fetch("/api/scheduled", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, scheduledAt: new Date().toISOString() }) });
    loadScheduled();
  }

  async function deleteScheduled(id: string) {
    await fetch("/api/scheduled", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
    loadScheduled();
  }

  function fmtTime(ts: string) {
    if (!ts) return "";
    return new Date(ts).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  }

  const filteredChats = chatSearch
    ? chats.filter((c) => c.name.toLowerCase().includes(chatSearch.toLowerCase()))
    : chats;

  return (
    <main style={{ maxWidth: 1100, margin: "0 auto", fontFamily: "sans-serif" }}>
      {/* Header */}
      <div style={{ padding: "0.8rem 1rem", borderBottom: "1px solid #ddd", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ display: "flex", gap: "1rem", alignItems: "center" }}>
          <h1 style={{ margin: 0, fontSize: "1.2rem" }}>Chat WhatsApp</h1>
          <button onClick={() => setView("chat")} style={{ background: view === "chat" ? "#333" : "#eee", color: view === "chat" ? "#fff" : "#333", border: "none", padding: "0.3rem 0.8rem", borderRadius: "4px", cursor: "pointer" }}>Chat</button>
          <button onClick={() => setView("scheduled")} style={{ background: view === "scheduled" ? "#333" : "#eee", color: view === "scheduled" ? "#fff" : "#333", border: "none", padding: "0.3rem 0.8rem", borderRadius: "4px", cursor: "pointer" }}>Agendadas</button>
        </div>
        <a href="/admin" style={{ textDecoration: "none", color: "#666" }}>← Admin</a>
      </div>

      {view === "chat" && (
        <div style={{ display: "flex", minHeight: "calc(100vh - 60px)" }}>
          {/* Left: Conversations */}
          <div style={{ width: 320, borderRight: "1px solid #ddd", display: "flex", flexDirection: "column", minHeight: 0 }}>
            <div style={{ padding: "0.5rem" }}>
              <input placeholder="Buscar conversa..." value={chatSearch}
                onChange={(e) => setChatSearch(e.target.value)}
                style={{ width: "100%", padding: "0.5rem", boxSizing: "border-box", borderRadius: "20px", border: "1px solid #ddd" }} />
            </div>
            <div style={{ flex: 1, overflowY: "auto" }}>
              {chatsLoading && <p style={{ padding: "1rem", color: "#999" }}>Carregando...</p>}
              {filteredChats.map((c) => (
                <div key={c.jid} onClick={() => selectChat(c)}
                  style={{
                    display: "flex", alignItems: "center", gap: "0.6rem",
                    padding: "0.5rem 0.8rem", cursor: "pointer", borderBottom: "1px solid #f0f0f0",
                    background: selectedChat?.jid === c.jid ? "#e3f2fd" : "transparent",
                  }}>
                  <div style={{
                    width: 42, height: 42, borderRadius: "50%", flexShrink: 0,
                    background: c.photo ? `url(${c.photo}) center/cover` : "#bbb",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: "1rem", color: "#fff", overflow: "hidden",
                  }}>
                    {!c.photo && (c.isGroup ? "👥" : c.name.charAt(0).toUpperCase())}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span style={{ fontWeight: 600, fontSize: "0.85rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.name}</span>
                      <span style={{ fontSize: "0.65rem", color: c.unread > 0 ? "#25D366" : "#999", flexShrink: 0 }}>{c.timeLabel}</span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "0.1rem" }}>
                      <span style={{ fontSize: "0.75rem", color: "#777", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {c.lastMessage ? `${c.lastMessage.fromMe ? "✓ " : ""}${c.lastMessage.text}` : ""}
                      </span>
                      <div style={{ display: "flex", gap: "0.15rem", alignItems: "center", flexShrink: 0 }}>
                        {c.muted && <span style={{ fontSize: "0.6rem" }}>🔇</span>}
                        {c.pinned && <span style={{ fontSize: "0.6rem" }}>📌</span>}
                        {c.unread > 0 && <span style={{ background: "#25D366", color: "#fff", borderRadius: "10px", padding: "0 0.35rem", fontSize: "0.6rem", fontWeight: 700 }}>{c.unread}</span>}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Right: Messages */}
          <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
            {selectedChat ? (
              <>
                <div style={{ padding: "0.7rem 1rem", borderBottom: "1px solid #ddd", fontWeight: 600, fontSize: "0.95rem" }}>
                  {selectedChat.name}
                </div>
                <div style={{ flex: 1, overflowY: "auto", padding: "1rem", background: "#f0f0f0", maxHeight: "calc(100vh - 200px)" }}>
                  {loadingMsgs ? <p style={{ color: "#999" }}>Carregando mensagens...</p> : (
                    messages.length === 0 ? <p style={{ color: "#999" }}>Nenhuma mensagem encontrada</p> :
                    messages.map((m, i) => (
                      <div key={i} style={{ display: "flex", justifyContent: m.fromMe ? "flex-end" : "flex-start", marginBottom: "0.4rem" }}>
                        <div style={{
                          maxWidth: "70%", padding: "0.4rem 0.7rem", borderRadius: "8px",
                          background: m.fromMe ? "#dcf8c6" : "#fff",
                          boxShadow: "0 1px 1px rgba(0,0,0,0.08)",
                        }}>
                          {!m.fromMe && selectedChat.isGroup && <div style={{ fontSize: "0.7rem", color: "#1976d2", fontWeight: 600, marginBottom: "0.1rem" }}>{m.sender}</div>}
                          <div style={{ fontSize: "0.85rem", whiteSpace: "pre-wrap" }}>{m.text || `[${m.type}]`}</div>
                          <div style={{ fontSize: "0.6rem", color: "#999", textAlign: "right", marginTop: "0.1rem" }}>{fmtTime(m.timestamp)}</div>
                        </div>
                      </div>
                    ))
                  )}
                  <div ref={messagesEndRef} />
                </div>

                {/* Input area */}
                <div style={{ padding: "0.6rem", borderTop: "1px solid #ddd", background: "#fff" }}>
                  {showSchedule && (
                    <div style={{ marginBottom: "0.6rem", padding: "0.6rem", background: "#f9f9f9", border: "1px solid #ddd", borderRadius: "4px", fontSize: "0.85rem" }}>
                      <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap", marginBottom: "0.4rem" }}>
                        {[["1h", "Em 1h"], ["3h", "Em 3h"], ["amanha9", "Amanhã 9h"], ["amanha14", "Amanhã 14h"], ["seg9", "Seg 9h"]].map(([k, v]) => (
                          <button key={k} onClick={() => applyPreset(k)} style={{ padding: "0.2rem 0.5rem", fontSize: "0.75rem", cursor: "pointer", border: "1px solid #ccc", borderRadius: "4px", background: "#fff" }}>{v}</button>
                        ))}
                      </div>
                      <div style={{ display: "flex", gap: "0.4rem", marginBottom: "0.4rem" }}>
                        <input type="date" value={schedDate} onChange={(e) => setSchedDate(e.target.value)} style={{ padding: "0.3rem" }} />
                        <input type="time" value={schedTime} onChange={(e) => setSchedTime(e.target.value)} style={{ padding: "0.3rem" }} />
                      </div>
                      <label style={{ display: "flex", alignItems: "center", gap: "0.3rem", fontSize: "0.8rem", marginBottom: "0.4rem" }}>
                        <input type="checkbox" checked={isRecurring} onChange={(e) => setIsRecurring(e.target.checked)} /> Recorrente
                      </label>
                      {isRecurring && (
                        <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap", marginBottom: "0.4rem" }}>
                          <select value={recurPattern} onChange={(e) => setRecurPattern(e.target.value)} style={{ padding: "0.3rem" }}>
                            <option value="daily">Diário</option><option value="weekly">Semanal</option><option value="monthly">Mensal</option>
                          </select>
                          <label style={{ fontSize: "0.8rem" }}>cada <input type="number" value={recurInterval} onChange={(e) => setRecurInterval(Number(e.target.value))} min={1} style={{ width: "2.5rem", padding: "0.2rem" }} /></label>
                          {recurPattern === "weekly" && (
                            <div style={{ display: "flex", gap: "0.2rem" }}>
                              {["D", "S", "T", "Q", "Q", "S", "S"].map((d, i) => (
                                <button key={i} onClick={() => setRecurDays((p) => p.includes(i) ? p.filter((x) => x !== i) : [...p, i])}
                                  style={{ width: "1.5rem", height: "1.5rem", fontSize: "0.65rem", background: recurDays.includes(i) ? "#333" : "#eee", color: recurDays.includes(i) ? "#fff" : "#333", border: "none", borderRadius: "3px", cursor: "pointer" }}>{d}</button>
                              ))}
                            </div>
                          )}
                          <input type="date" value={recurEndDate} onChange={(e) => setRecurEndDate(e.target.value)} style={{ padding: "0.3rem" }} />
                        </div>
                      )}
                      <div style={{ display: "flex", gap: "0.4rem" }}>
                        <button onClick={scheduleMsg} style={{ padding: "0.3rem 0.8rem", background: "#4CAF50", color: "#fff", border: "none", borderRadius: "4px", cursor: "pointer", fontSize: "0.8rem" }}>Agendar</button>
                        <button onClick={() => setShowSchedule(false)} style={{ padding: "0.3rem 0.8rem", fontSize: "0.8rem", cursor: "pointer" }}>Cancelar</button>
                      </div>
                    </div>
                  )}
                  <div style={{ display: "flex", gap: "0.4rem" }}>
                    <input value={msgText} onChange={(e) => setMsgText(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendNow(); } }}
                      placeholder="Digite uma mensagem..."
                      style={{ flex: 1, padding: "0.5rem 0.8rem", borderRadius: "20px", border: "1px solid #ccc" }} />
                    <button onClick={sendNow} disabled={sending || !msgText.trim()}
                      style={{ padding: "0.5rem 0.8rem", background: "#25D366", color: "#fff", border: "none", borderRadius: "20px", cursor: "pointer", fontSize: "0.85rem" }}>
                      {sending ? "..." : "Enviar"}
                    </button>
                    <button onClick={() => setShowSchedule(!showSchedule)}
                      style={{ padding: "0.5rem", background: showSchedule ? "#333" : "#eee", color: showSchedule ? "#fff" : "#333", border: "none", borderRadius: "20px", cursor: "pointer" }}>⏰</button>
                  </div>
                </div>
              </>
            ) : (
              <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "#999", fontSize: "1.1rem" }}>
                Selecione uma conversa
              </div>
            )}
          </div>
        </div>
      )}

      {view === "scheduled" && (
        <div style={{ padding: "1rem" }}>
          <div style={{ display: "flex", gap: "0.4rem", marginBottom: "1rem" }}>
            {[["pending", "Pendentes"], ["sent", "Enviadas"], ["failed", "Falharam"], ["cancelled", "Canceladas"], ["", "Todas"]].map(([s, label]) => (
              <button key={s} onClick={() => setSchedFilter(s)}
                style={{ padding: "0.3rem 0.7rem", background: schedFilter === s ? "#333" : "#eee", color: schedFilter === s ? "#fff" : "#333", border: "none", borderRadius: "4px", cursor: "pointer", fontSize: "0.85rem" }}>{label}</button>
            ))}
          </div>
          {scheduledMsgs.length === 0 ? <p style={{ color: "#999" }}>Nenhuma mensagem agendada</p> : (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" }}>
              <thead>
                <tr style={{ borderBottom: "2px solid #333" }}>
                  <th style={{ textAlign: "left", padding: "0.4rem" }}>Destinatário</th>
                  <th style={{ textAlign: "left", padding: "0.4rem" }}>Mensagem</th>
                  <th style={{ textAlign: "left", padding: "0.4rem" }}>Agendada para</th>
                  <th style={{ textAlign: "center", padding: "0.4rem" }}>Status</th>
                  <th style={{ padding: "0.4rem" }}>Ações</th>
                </tr>
              </thead>
              <tbody>
                {scheduledMsgs.map((m) => (
                  <tr key={m.id} style={{ borderBottom: "1px solid #eee" }}>
                    <td style={{ padding: "0.4rem" }}>{m.contact_name || m.recipient}</td>
                    <td style={{ padding: "0.4rem", maxWidth: 250, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {m.is_recurring && "🔄 "}{m.content}
                    </td>
                    <td style={{ padding: "0.4rem", fontSize: "0.8rem" }}>{fmtTime(m.scheduled_at)}</td>
                    <td style={{ padding: "0.4rem", textAlign: "center" }}>
                      <span style={{
                        padding: "0.15rem 0.4rem", borderRadius: "10px", fontSize: "0.7rem",
                        background: m.status === "sent" ? "#e8f5e9" : m.status === "failed" ? "#ffebee" : m.status === "cancelled" ? "#f5f5f5" : "#fff3e0",
                        color: m.status === "sent" ? "#2e7d32" : m.status === "failed" ? "#c62828" : m.status === "cancelled" ? "#666" : "#e65100",
                      }}>{m.status}</span>
                    </td>
                    <td style={{ padding: "0.4rem" }}>
                      {m.status === "pending" && (
                        <>
                          <button onClick={() => sendScheduledNow(m.id)} style={{ fontSize: "0.7rem", padding: "0.15rem 0.3rem", cursor: "pointer", marginRight: "0.2rem" }}>Enviar</button>
                          <button onClick={() => cancelScheduled(m.id)} style={{ fontSize: "0.7rem", padding: "0.15rem 0.3rem", cursor: "pointer", color: "orange" }}>Cancelar</button>
                        </>
                      )}
                      {m.status !== "pending" && (
                        <button onClick={() => deleteScheduled(m.id)} style={{ fontSize: "0.7rem", padding: "0.15rem 0.3rem", cursor: "pointer", color: "red" }}>Excluir</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </main>
  );
}
