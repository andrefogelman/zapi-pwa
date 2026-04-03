"use client";

import { useEffect, useState, useRef } from "react";
import { getSupabaseBrowser } from "@/lib/supabase-browser";

interface Chat {
  jid: string;
  name: string;
  isGroup: boolean;
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

type View = "chat" | "scheduled";

export default function ChatPage() {
  const [view, setView] = useState<View>("chat");

  // Chat state
  const [chats, setChats] = useState<Chat[]>([]);
  const [chatSearch, setChatSearch] = useState("");
  const [selectedChat, setSelectedChat] = useState<Chat | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loadingMsgs, setLoadingMsgs] = useState(false);

  // Send state
  const [msgText, setMsgText] = useState("");
  const [sending, setSending] = useState(false);

  // Schedule modal state
  const [showSchedule, setShowSchedule] = useState(false);
  const [schedDate, setSchedDate] = useState("");
  const [schedTime, setSchedTime] = useState("");
  const [isRecurring, setIsRecurring] = useState(false);
  const [recurPattern, setRecurPattern] = useState("daily");
  const [recurInterval, setRecurInterval] = useState(1);
  const [recurDays, setRecurDays] = useState<number[]>([]);
  const [recurEndDate, setRecurEndDate] = useState("");

  // Scheduled messages list
  const [scheduledMsgs, setScheduledMsgs] = useState<ScheduledMsg[]>([]);
  const [schedFilter, setSchedFilter] = useState("pending");

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const supabase = getSupabaseBrowser();

  useEffect(() => { loadChats(); }, []);
  useEffect(() => { if (view === "scheduled") loadScheduled(); }, [view, schedFilter]);
  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  async function loadChats(query?: string) {
    const res = await fetch(`/api/conversations?limit=200${query ? `&query=${encodeURIComponent(query)}` : ""}`);
    const data = await res.json();
    if (data.chats) setChats(data.chats);
  }

  async function selectChat(chat: Chat) {
    setSelectedChat(chat);
    setLoadingMsgs(true);
    const res = await fetch(`/api/messages?chat=${encodeURIComponent(chat.jid)}&limit=50`);
    const data = await res.json();
    setMessages(data.messages || []);
    setLoadingMsgs(false);
  }

  async function sendNow() {
    if (!selectedChat || !msgText.trim()) return;
    setSending(true);
    await fetch("/api/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ recipient: selectedChat.jid, contentType: "text", content: msgText }),
    });
    setMsgText("");
    setSending(false);
    // Reload messages after a short delay
    setTimeout(() => selectChat(selectedChat), 1500);
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
    setSchedDate("");
    setSchedTime("");
    setIsRecurring(false);
  }

  function applyPreset(preset: string) {
    const now = new Date();
    const brt = new Date(now.getTime() - 3 * 60 * 60 * 1000);
    let target: Date;
    switch (preset) {
      case "1h": target = new Date(brt.getTime() + 60 * 60 * 1000); break;
      case "3h": target = new Date(brt.getTime() + 3 * 60 * 60 * 1000); break;
      case "amanha9": target = new Date(brt); target.setDate(target.getDate() + 1); target.setHours(9, 0, 0, 0); break;
      case "amanha14": target = new Date(brt); target.setDate(target.getDate() + 1); target.setHours(14, 0, 0, 0); break;
      case "seg9": {
        target = new Date(brt);
        const day = target.getDay();
        const daysUntilMon = day === 0 ? 1 : day === 1 ? 7 : 8 - day;
        target.setDate(target.getDate() + daysUntilMon);
        target.setHours(9, 0, 0, 0);
        break;
      }
      default: return;
    }
    setSchedDate(target.toISOString().split("T")[0]);
    setSchedTime(target.toISOString().substring(11, 16));
  }

  async function loadScheduled() {
    const res = await fetch(`/api/scheduled${schedFilter ? `?status=${schedFilter}` : ""}`);
    const data = await res.json();
    setScheduledMsgs(data.messages || []);
  }

  async function cancelScheduled(id: string) {
    await fetch("/api/scheduled", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, status: "cancelled" }),
    });
    loadScheduled();
  }

  async function sendScheduledNow(id: string) {
    await fetch("/api/scheduled", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, scheduledAt: new Date().toISOString() }),
    });
    loadScheduled();
  }

  async function deleteScheduled(id: string) {
    await fetch("/api/scheduled", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    loadScheduled();
  }

  function formatTime(ts: string) {
    if (!ts) return "";
    const d = new Date(ts);
    return d.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  }

  const tabStyle = (t: View) => ({
    padding: "0.5rem 1.5rem", cursor: "pointer" as const, border: "none",
    borderBottom: view === t ? "3px solid #333" : "3px solid transparent",
    background: "none", fontWeight: view === t ? "bold" as const : "normal" as const, fontSize: "1rem",
  });

  return (
    <main style={{ maxWidth: 1000, margin: "0 auto", fontFamily: "sans-serif", height: "100vh", display: "flex", flexDirection: "column" }}>
      {/* Header */}
      <div style={{ padding: "1rem", borderBottom: "1px solid #ddd", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h1 style={{ margin: 0, fontSize: "1.3rem" }}>Chat WhatsApp</h1>
        <a href="/admin" style={{ textDecoration: "none", color: "#666" }}>← Admin</a>
      </div>

      {/* Tabs */}
      <div style={{ borderBottom: "1px solid #ddd" }}>
        <button style={tabStyle("chat")} onClick={() => setView("chat")}>Chat</button>
        <button style={tabStyle("scheduled")} onClick={() => setView("scheduled")}>Agendadas ({scheduledMsgs.length})</button>
      </div>

      {view === "chat" && (
        <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
          {/* Left: Conversations */}
          <div style={{ width: "300px", borderRight: "1px solid #ddd", display: "flex", flexDirection: "column" }}>
            <div style={{ padding: "0.5rem" }}>
              <input placeholder="Buscar conversa..." value={chatSearch}
                onChange={(e) => { setChatSearch(e.target.value); loadChats(e.target.value); }}
                style={{ width: "100%", padding: "0.5rem", boxSizing: "border-box" }} />
            </div>
            <div style={{ flex: 1, overflowY: "auto" }}>
              {chats.map((c) => (
                <div key={c.jid} onClick={() => selectChat(c)}
                  style={{
                    padding: "0.6rem 0.8rem", cursor: "pointer", borderBottom: "1px solid #eee",
                    background: selectedChat?.jid === c.jid ? "#e3f2fd" : "transparent",
                  }}>
                  <div style={{ fontWeight: 500, fontSize: "0.9rem" }}>{c.isGroup ? "👥 " : ""}{c.name}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Right: Messages */}
          <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
            {selectedChat ? (
              <>
                {/* Chat header */}
                <div style={{ padding: "0.8rem 1rem", borderBottom: "1px solid #ddd", fontWeight: 600 }}>
                  {selectedChat.name}
                </div>

                {/* Messages */}
                <div style={{ flex: 1, overflowY: "auto", padding: "1rem", background: "#f5f5f5" }}>
                  {loadingMsgs ? <p>Carregando...</p> : messages.map((m, i) => (
                    <div key={i} style={{
                      display: "flex", justifyContent: m.fromMe ? "flex-end" : "flex-start", marginBottom: "0.5rem",
                    }}>
                      <div style={{
                        maxWidth: "70%", padding: "0.5rem 0.8rem", borderRadius: "8px",
                        background: m.fromMe ? "#dcf8c6" : "#fff",
                        boxShadow: "0 1px 1px rgba(0,0,0,0.1)",
                      }}>
                        {!m.fromMe && <div style={{ fontSize: "0.75rem", color: "#1976d2", fontWeight: 600, marginBottom: "0.2rem" }}>{m.sender}</div>}
                        <div style={{ fontSize: "0.9rem", whiteSpace: "pre-wrap" }}>{m.text || `[${m.type}]`}</div>
                        <div style={{ fontSize: "0.7rem", color: "#999", textAlign: "right", marginTop: "0.2rem" }}>{formatTime(m.timestamp)}</div>
                      </div>
                    </div>
                  ))}
                  <div ref={messagesEndRef} />
                </div>

                {/* Input */}
                <div style={{ padding: "0.8rem", borderTop: "1px solid #ddd", background: "#fff" }}>
                  {showSchedule && (
                    <div style={{ marginBottom: "0.8rem", padding: "0.8rem", background: "#f9f9f9", border: "1px solid #ddd", borderRadius: "4px" }}>
                      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginBottom: "0.5rem" }}>
                        {[["1h", "Em 1h"], ["3h", "Em 3h"], ["amanha9", "Amanhã 9h"], ["amanha14", "Amanhã 14h"], ["seg9", "Segunda 9h"]].map(([k, v]) => (
                          <button key={k} onClick={() => applyPreset(k)} style={{ padding: "0.3rem 0.6rem", fontSize: "0.8rem", cursor: "pointer", border: "1px solid #ccc", borderRadius: "4px", background: "#fff" }}>{v}</button>
                        ))}
                      </div>
                      <div style={{ display: "flex", gap: "0.5rem", marginBottom: "0.5rem" }}>
                        <input type="date" value={schedDate} onChange={(e) => setSchedDate(e.target.value)} style={{ padding: "0.4rem" }} />
                        <input type="time" value={schedTime} onChange={(e) => setSchedTime(e.target.value)} style={{ padding: "0.4rem" }} />
                      </div>
                      <label style={{ display: "flex", alignItems: "center", gap: "0.3rem", fontSize: "0.85rem", marginBottom: "0.5rem" }}>
                        <input type="checkbox" checked={isRecurring} onChange={(e) => setIsRecurring(e.target.checked)} />
                        Recorrente
                      </label>
                      {isRecurring && (
                        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginBottom: "0.5rem" }}>
                          <select value={recurPattern} onChange={(e) => setRecurPattern(e.target.value)} style={{ padding: "0.4rem" }}>
                            <option value="daily">Diário</option>
                            <option value="weekly">Semanal</option>
                            <option value="monthly">Mensal</option>
                          </select>
                          <label style={{ fontSize: "0.85rem" }}>a cada <input type="number" value={recurInterval} onChange={(e) => setRecurInterval(Number(e.target.value))} min={1} style={{ width: "3rem", padding: "0.3rem" }} /></label>
                          {recurPattern === "weekly" && (
                            <div style={{ display: "flex", gap: "0.3rem" }}>
                              {["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"].map((d, i) => (
                                <button key={i} onClick={() => setRecurDays(prev => prev.includes(i) ? prev.filter(x => x !== i) : [...prev, i])}
                                  style={{ padding: "0.2rem 0.4rem", fontSize: "0.75rem", background: recurDays.includes(i) ? "#333" : "#eee", color: recurDays.includes(i) ? "#fff" : "#333", border: "none", borderRadius: "3px", cursor: "pointer" }}>{d}</button>
                              ))}
                            </div>
                          )}
                          <input type="date" value={recurEndDate} onChange={(e) => setRecurEndDate(e.target.value)} placeholder="Fim" style={{ padding: "0.4rem" }} />
                        </div>
                      )}
                      <div style={{ display: "flex", gap: "0.5rem" }}>
                        <button onClick={scheduleMsg} style={{ padding: "0.4rem 1rem", background: "#4CAF50", color: "#fff", border: "none", borderRadius: "4px", cursor: "pointer" }}>Agendar</button>
                        <button onClick={() => setShowSchedule(false)} style={{ padding: "0.4rem 1rem", cursor: "pointer" }}>Cancelar</button>
                      </div>
                    </div>
                  )}
                  <div style={{ display: "flex", gap: "0.5rem" }}>
                    <input value={msgText} onChange={(e) => setMsgText(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendNow(); } }}
                      placeholder="Digite uma mensagem..."
                      style={{ flex: 1, padding: "0.6rem", borderRadius: "20px", border: "1px solid #ccc" }} />
                    <button onClick={sendNow} disabled={sending || !msgText.trim()}
                      style={{ padding: "0.6rem 1rem", background: "#25D366", color: "#fff", border: "none", borderRadius: "20px", cursor: "pointer" }}>
                      {sending ? "..." : "Enviar"}
                    </button>
                    <button onClick={() => setShowSchedule(!showSchedule)}
                      style={{ padding: "0.6rem 0.8rem", background: showSchedule ? "#333" : "#eee", color: showSchedule ? "#fff" : "#333", border: "none", borderRadius: "20px", cursor: "pointer" }}
                      title="Agendar">⏰</button>
                  </div>
                </div>
              </>
            ) : (
              <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "#999" }}>
                Selecione uma conversa
              </div>
            )}
          </div>
        </div>
      )}

      {view === "scheduled" && (
        <div style={{ flex: 1, overflowY: "auto", padding: "1rem" }}>
          <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem" }}>
            {["pending", "sent", "failed", "cancelled", ""].map((s) => (
              <button key={s} onClick={() => setSchedFilter(s)}
                style={{ padding: "0.3rem 0.8rem", background: schedFilter === s ? "#333" : "#eee", color: schedFilter === s ? "#fff" : "#333", border: "none", borderRadius: "4px", cursor: "pointer" }}>
                {s === "" ? "Todas" : s === "pending" ? "Pendentes" : s === "sent" ? "Enviadas" : s === "failed" ? "Falharam" : "Canceladas"}
              </button>
            ))}
          </div>

          {scheduledMsgs.length === 0 ? (
            <p style={{ color: "#999" }}>Nenhuma mensagem agendada</p>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: "2px solid #333" }}>
                  <th style={{ textAlign: "left", padding: "0.5rem" }}>Destinatário</th>
                  <th style={{ textAlign: "left", padding: "0.5rem" }}>Mensagem</th>
                  <th style={{ textAlign: "left", padding: "0.5rem" }}>Agendada para</th>
                  <th style={{ textAlign: "center", padding: "0.5rem" }}>Status</th>
                  <th style={{ padding: "0.5rem" }}>Ações</th>
                </tr>
              </thead>
              <tbody>
                {scheduledMsgs.map((m) => (
                  <tr key={m.id} style={{ borderBottom: "1px solid #eee" }}>
                    <td style={{ padding: "0.5rem", fontSize: "0.85rem" }}>{m.contact_name || m.recipient}</td>
                    <td style={{ padding: "0.5rem", fontSize: "0.85rem", maxWidth: "300px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {m.is_recurring && <span title={`${m.recurrence_pattern}`}>🔄 </span>}
                      {m.content}
                    </td>
                    <td style={{ padding: "0.5rem", fontSize: "0.8rem" }}>{formatTime(m.scheduled_at)}</td>
                    <td style={{ padding: "0.5rem", textAlign: "center" }}>
                      <span style={{
                        padding: "0.2rem 0.5rem", borderRadius: "10px", fontSize: "0.75rem",
                        background: m.status === "sent" ? "#e8f5e9" : m.status === "failed" ? "#ffebee" : m.status === "cancelled" ? "#f5f5f5" : "#fff3e0",
                        color: m.status === "sent" ? "#2e7d32" : m.status === "failed" ? "#c62828" : m.status === "cancelled" ? "#666" : "#e65100",
                      }}>{m.status}</span>
                      {m.error && <div style={{ fontSize: "0.7rem", color: "red", marginTop: "0.2rem" }}>{m.error}</div>}
                    </td>
                    <td style={{ padding: "0.5rem", display: "flex", gap: "0.3rem" }}>
                      {m.status === "pending" && (
                        <>
                          <button onClick={() => sendScheduledNow(m.id)} style={{ fontSize: "0.75rem", padding: "0.2rem 0.4rem", cursor: "pointer" }}>Enviar agora</button>
                          <button onClick={() => cancelScheduled(m.id)} style={{ fontSize: "0.75rem", padding: "0.2rem 0.4rem", cursor: "pointer", color: "orange" }}>Cancelar</button>
                        </>
                      )}
                      {(m.status === "sent" || m.status === "cancelled" || m.status === "failed") && (
                        <button onClick={() => deleteScheduled(m.id)} style={{ fontSize: "0.75rem", padding: "0.2rem 0.4rem", cursor: "pointer", color: "red" }}>Excluir</button>
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
