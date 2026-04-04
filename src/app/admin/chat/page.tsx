"use client";

import { useEffect, useState, useRef, Component } from "react";
import type { ReactNode } from "react";

class ErrorBoundary extends Component<{ children: ReactNode }, { error: string | null }> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error: Error) {
    return { error: `${error.message}\n\n${error.stack}` };
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: "2rem", fontFamily: "monospace", whiteSpace: "pre-wrap" }}>
          <h1 style={{ color: "red" }}>Chat Error</h1>
          <p>{this.state.error}</p>
        </div>
      );
    }
    return this.props.children;
  }
}

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

interface Msg {
  sender: string;
  timestamp: string;
  text: string;
  type: string;
  fromMe: boolean;
  msgId: string;
  chatName: string;
}

interface SchedMsg {
  id: string;
  recipient: string;
  contact_name: string;
  content: string;
  scheduled_at: string;
  status: string;
  is_recurring: boolean;
  recurrence_pattern: string | null;
  error: string | null;
}

function MediaThumb({ chat, msgId, type }: { chat: string; msgId: string; type: string }) {
  const [state, setState] = useState<"idle" | "loading" | "loaded" | "error">("idle");
  const url = `/api/media?chat=${encodeURIComponent(chat)}&id=${encodeURIComponent(msgId)}`;
  const icon = type === "video" ? "🎥" : type === "sticker" ? "🏷️" : "📷";
  const label = type === "video" ? "Vídeo" : type === "sticker" ? "Sticker" : "Imagem";

  if (state === "error") {
    return (
      <div style={{ padding:"0.3rem 0.5rem", background:"#f5f5f5", borderRadius:4, fontSize:"0.7rem", color:"#999", display:"inline-block", marginBottom:"0.2rem" }}>
        {icon} {label}
      </div>
    );
  }
  if (state === "idle") {
    return (
      <div onClick={() => setState("loading")}
        style={{ padding:"0.4rem 0.6rem", background:"#e0e0e0", borderRadius:4, cursor:"pointer", fontSize:"0.75rem", color:"#555", display:"inline-block", marginBottom:"0.2rem" }}>
        {icon} {label} — clique para ver
      </div>
    );
  }
  return (
    <>
      {state === "loading" && <div style={{ fontSize:"0.7rem", color:"#999", marginBottom:"0.2rem" }}>Carregando...</div>}
      <img src={url} alt={type}
        style={{ maxWidth:"100%", maxHeight:300, borderRadius:4, display: state === "loaded" ? "block" : "none", marginBottom:"0.2rem" }}
        onLoad={() => setState("loaded")}
        onError={() => setState("error")}
      />
    </>
  );
}

function ChatApp() {
  const [view, setView] = useState<"chat" | "scheduled">("chat");
  const [chats, setChats] = useState<Chat[]>([]);
  const [chatSearch, setChatSearch] = useState("");
  const [chatsLoading, setChatsLoading] = useState(true);
  const [selectedChat, setSelectedChat] = useState<Chat | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [loadingMsgs, setLoadingMsgs] = useState(false);
  const [msgText, setMsgText] = useState("");
  const [sending, setSending] = useState(false);
  const [showSchedule, setShowSchedule] = useState(false);
  const [schedDate, setSchedDate] = useState("");
  const [schedTime, setSchedTime] = useState("");
  const [isRecurring, setIsRecurring] = useState(false);
  const [recurPattern, setRecurPattern] = useState("daily");
  const [recurInterval, setRecurInterval] = useState(1);
  const [recurDays, setRecurDays] = useState<number[]>([]);
  const [recurEndDate, setRecurEndDate] = useState("");
  const [scheduledMsgs, setScheduledMsgs] = useState<SchedMsg[]>([]);
  const [schedFilter, setSchedFilter] = useState("pending");
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => { loadChats(); }, []);
  useEffect(() => { if (view === "scheduled") loadScheduled(); }, [view, schedFilter]);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  async function loadChats(q?: string) {
    setChatsLoading(true);
    try {
      const r = await fetch(`/api/conversations?limit=200${q ? `&query=${encodeURIComponent(q)}` : ""}`);
      const d = await r.json();
      if (d.chats) { setChats(d.chats); loadDetails(d.chats); }
    } catch (e) { console.error(e); }
    setChatsLoading(false);
  }

  async function loadDetails(list: Chat[]) {
    for (let i = 0; i < list.length; i += 15) {
      try {
        const chunk = list.slice(i, i + 15);
        const r = await fetch("/api/conversations/details", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chatJids: chunk.map(c => c.jid), phones: chunk.filter(c => !c.isGroup).map(c => c.phone) }),
        });
        if (!r.ok) continue;
        const d = await r.json();
        setChats(prev => prev.map(c => {
          const lm = d.lastMessages?.[c.jid];
          const ph = d.photos?.[c.phone];
          return (lm || ph) ? { ...c, lastMessage: lm || c.lastMessage, photo: ph || c.photo } : c;
        }));
      } catch { /* skip */ }
    }
  }

  async function openChat(chat: Chat) {
    setSelectedChat(chat);
    setLoadingMsgs(true);
    setMessages([]);
    try {
      const r = await fetch(`/api/messages?chat=${encodeURIComponent(chat.jid)}&limit=100${chat.phone ? `&phone=${encodeURIComponent(chat.phone)}` : ""}`);
      const d = await r.json();
      setMessages(d.messages || []);
    } catch { /* ignore */ }
    setLoadingMsgs(false);
  }

  async function sendNow() {
    if (!selectedChat || !msgText.trim()) return;
    setSending(true);
    try {
      await fetch("/api/send", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recipient: selectedChat.jid, contentType: "text", content: msgText }) });
      setMsgText("");
      // Wait for wacli sync to capture the sent message, then reload
      setTimeout(() => openChat(selectedChat), 3000);
    } catch { /* ignore */ }
    setSending(false);
  }

  async function scheduleMsg() {
    if (!selectedChat || !msgText.trim() || !schedDate || !schedTime) return;
    await fetch("/api/schedule", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        recipient: selectedChat.jid, contactName: selectedChat.name, chatJid: selectedChat.jid,
        contentType: "text", content: msgText,
        scheduledAt: new Date(`${schedDate}T${schedTime}:00-03:00`).toISOString(),
        isRecurring, recurrencePattern: isRecurring ? recurPattern : null,
        recurrenceInterval: isRecurring ? recurInterval : null,
        recurrenceDays: isRecurring && recurPattern === "weekly" ? recurDays : null,
        recurrenceEndDate: isRecurring && recurEndDate ? new Date(`${recurEndDate}T23:59:59-03:00`).toISOString() : null,
      }) });
    setMsgText(""); setShowSchedule(false);
  }

  function preset(p: string) {
    const now = new Date(); const b = new Date(now.getTime() - 10800000); let t: Date;
    if (p === "1h") t = new Date(b.getTime() + 3600000);
    else if (p === "3h") t = new Date(b.getTime() + 10800000);
    else if (p === "am9") { t = new Date(b); t.setDate(t.getDate()+1); t.setHours(9,0,0,0); }
    else if (p === "am14") { t = new Date(b); t.setDate(t.getDate()+1); t.setHours(14,0,0,0); }
    else { t = new Date(b); const d=t.getDay(); t.setDate(t.getDate()+(d===0?1:d===1?7:8-d)); t.setHours(9,0,0,0); }
    setSchedDate(t.toISOString().split("T")[0]);
    setSchedTime(t.toISOString().substring(11,16));
  }

  async function loadScheduled() {
    try { const r = await fetch(`/api/scheduled${schedFilter?`?status=${schedFilter}`:""}`); const d = await r.json(); setScheduledMsgs(d.messages||[]); } catch {}
  }
  async function cancelSched(id: string) { await fetch("/api/scheduled",{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({id,status:"cancelled"})}); loadScheduled(); }
  async function sendSched(id: string) {
    await fetch("/api/scheduled",{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({id,scheduledAt:new Date().toISOString()})});
    await fetch("/api/send-scheduled");
    loadScheduled();
  }
  async function delSched(id: string) { await fetch("/api/scheduled",{method:"DELETE",headers:{"Content-Type":"application/json"},body:JSON.stringify({id})}); loadScheduled(); }

  function fmt(ts: string) { return ts ? new Date(ts).toLocaleString("pt-BR",{timeZone:"America/Sao_Paulo",day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"}) : ""; }

  const filtered = chatSearch ? chats.filter(c => (c.name || "").toLowerCase().includes(chatSearch.toLowerCase())) : chats;

  return (
    <div style={{ maxWidth:1100, margin:"0 auto", fontFamily:"sans-serif" }}>
      <div style={{ padding:"0.7rem 1rem", borderBottom:"1px solid #ddd", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
        <div style={{ display:"flex", gap:"0.8rem", alignItems:"center" }}>
          <h1 style={{ margin:0, fontSize:"1.2rem" }}>Chat WhatsApp</h1>
          <button onClick={()=>setView("chat")} style={{ background:view==="chat"?"#333":"#eee", color:view==="chat"?"#fff":"#333", border:"none", padding:"0.25rem 0.7rem", borderRadius:4, cursor:"pointer" }}>Chat</button>
          <button onClick={()=>setView("scheduled")} style={{ background:view==="scheduled"?"#333":"#eee", color:view==="scheduled"?"#fff":"#333", border:"none", padding:"0.25rem 0.7rem", borderRadius:4, cursor:"pointer" }}>Agendadas</button>
        </div>
        <a href="/admin" style={{ color:"#666", textDecoration:"none" }}>← Admin</a>
      </div>

      {view === "chat" ? (
        <div style={{ display:"flex", height:"calc(100vh - 55px)" }}>
          {/* Sidebar */}
          <div style={{ width:310, borderRight:"1px solid #ddd", display:"flex", flexDirection:"column" }}>
            <div style={{ padding:"0.4rem" }}>
              <input placeholder="Buscar..." value={chatSearch} onChange={e=>setChatSearch(e.target.value)}
                style={{ width:"100%", padding:"0.4rem 0.7rem", boxSizing:"border-box", borderRadius:20, border:"1px solid #ddd" }} />
            </div>
            <div style={{ flex:1, overflowY:"auto" }}>
              {chatsLoading && <p style={{ padding:"1rem", color:"#999" }}>Carregando...</p>}
              {filtered.map(c => (
                <div key={c.jid} onClick={()=>openChat(c)} style={{
                  display:"flex", alignItems:"center", gap:"0.5rem", padding:"0.45rem 0.7rem", cursor:"pointer",
                  borderBottom:"1px solid #f0f0f0", background:selectedChat?.jid===c.jid?"#e3f2fd":"transparent" }}>
                  <div style={{ width:40, height:40, borderRadius:"50%", flexShrink:0, background:c.photo?`url(${c.photo}) center/cover`:"#bbb",
                    display:"flex", alignItems:"center", justifyContent:"center", fontSize:"0.95rem", color:"#fff", overflow:"hidden" }}>
                    {!c.photo && (c.isGroup ? "👥" : (c.name || "?").charAt(0).toUpperCase())}
                  </div>
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ display:"flex", justifyContent:"space-between" }}>
                      <span style={{ fontWeight:600, fontSize:"0.83rem", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{c.name}</span>
                      <span style={{ fontSize:"0.63rem", color:c.unread>0?"#25D366":"#999", flexShrink:0 }}>{c.timeLabel}</span>
                    </div>
                    <div style={{ display:"flex", justifyContent:"space-between", marginTop:"0.05rem" }}>
                      <span style={{ fontSize:"0.73rem", color:"#777", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                        {c.lastMessage ? `${c.lastMessage.fromMe?"✓ ":""}${c.lastMessage.text}` : ""}
                      </span>
                      <span style={{ flexShrink:0, display:"flex", gap:"0.1rem", alignItems:"center" }}>
                        {c.muted && <span style={{fontSize:"0.55rem"}}>🔇</span>}
                        {c.pinned && <span style={{fontSize:"0.55rem"}}>📌</span>}
                        {c.unread>0 && <span style={{ background:"#25D366", color:"#fff", borderRadius:10, padding:"0 0.3rem", fontSize:"0.58rem", fontWeight:700 }}>{c.unread}</span>}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Chat area */}
          <div style={{ flex:1, display:"flex", flexDirection:"column" }}>
            {selectedChat ? (<>
              <div style={{ padding:"0.6rem 1rem", borderBottom:"1px solid #ddd", fontWeight:600 }}>{selectedChat.name}</div>
              <div style={{ flex:1, overflowY:"auto", padding:"0.8rem", background:"#f0f0f0" }}>
                {loadingMsgs ? <p style={{color:"#999"}}>Carregando...</p> :
                  messages.length===0 ? <p style={{color:"#999"}}>Sem mensagens</p> :
                  messages.map((m,i)=>(
                    <div key={i} style={{ display:"flex", justifyContent:m.fromMe?"flex-end":"flex-start", marginBottom:"0.35rem" }}>
                      <div style={{ maxWidth:"70%", padding:"0.35rem 0.6rem", borderRadius:8, background:m.fromMe?"#dcf8c6":"#fff", boxShadow:"0 1px 1px rgba(0,0,0,0.06)" }}>
                        {!m.fromMe && selectedChat.isGroup && <div style={{fontSize:"0.68rem",color:"#1976d2",fontWeight:600}}>{m.sender}</div>}
                        {(m.type === "image" || m.type === "video" || m.type === "sticker") && m.msgId ? (
                          <MediaThumb chat={selectedChat.jid} msgId={m.msgId} type={m.type} />
                        ) : null}
                        {m.text ? <div style={{ fontSize:"0.83rem", whiteSpace:"pre-wrap" }}>{m.text}</div> :
                          (m.type && m.type !== "image" && m.type !== "video" && m.type !== "sticker" && m.type !== "text" && m.type !== "") ?
                          <div style={{ fontSize:"0.83rem", fontStyle:"italic", color:"#999" }}>[{m.type}]</div> : null}
                        <div style={{ fontSize:"0.58rem", color:"#999", textAlign:"right" }}>{fmt(m.timestamp)}</div>
                      </div>
                    </div>
                  ))}
                <div ref={endRef}/>
              </div>
              <div style={{ padding:"0.5rem", borderTop:"1px solid #ddd" }}>
                {showSchedule && (
                  <div style={{ marginBottom:"0.5rem", padding:"0.5rem", background:"#f9f9f9", border:"1px solid #ddd", borderRadius:4, fontSize:"0.8rem" }}>
                    <div style={{ display:"flex", gap:"0.3rem", flexWrap:"wrap", marginBottom:"0.3rem" }}>
                      {[["1h","1h"],["3h","3h"],["am9","Amanhã 9h"],["am14","Amanhã 14h"],["seg","Seg 9h"]].map(([k,v])=>(
                        <button key={k} onClick={()=>preset(k)} style={{padding:"0.15rem 0.4rem",fontSize:"0.7rem",cursor:"pointer",border:"1px solid #ccc",borderRadius:4,background:"#fff"}}>{v}</button>
                      ))}
                    </div>
                    <div style={{ display:"flex", gap:"0.3rem", marginBottom:"0.3rem" }}>
                      <input type="date" value={schedDate} onChange={e=>setSchedDate(e.target.value)} style={{padding:"0.25rem"}}/>
                      <input type="time" value={schedTime} onChange={e=>setSchedTime(e.target.value)} style={{padding:"0.25rem"}}/>
                    </div>
                    <label style={{display:"flex",alignItems:"center",gap:"0.2rem",fontSize:"0.75rem",marginBottom:"0.3rem"}}>
                      <input type="checkbox" checked={isRecurring} onChange={e=>setIsRecurring(e.target.checked)}/> Recorrente
                    </label>
                    {isRecurring && (
                      <div style={{display:"flex",gap:"0.3rem",flexWrap:"wrap",marginBottom:"0.3rem"}}>
                        <select value={recurPattern} onChange={e=>setRecurPattern(e.target.value)} style={{padding:"0.2rem",fontSize:"0.75rem"}}>
                          <option value="daily">Diário</option><option value="weekly">Semanal</option><option value="monthly">Mensal</option>
                        </select>
                        <span style={{fontSize:"0.75rem"}}>cada <input type="number" value={recurInterval} onChange={e=>setRecurInterval(Number(e.target.value))} min={1} style={{width:"2rem",padding:"0.15rem"}}/></span>
                        {recurPattern==="weekly" && <div style={{display:"flex",gap:"0.15rem"}}>
                          {["D","S","T","Q","Q","S","S"].map((d,i)=>(
                            <button key={i} onClick={()=>setRecurDays(p=>p.includes(i)?p.filter(x=>x!==i):[...p,i])}
                              style={{width:"1.3rem",height:"1.3rem",fontSize:"0.6rem",background:recurDays.includes(i)?"#333":"#eee",color:recurDays.includes(i)?"#fff":"#333",border:"none",borderRadius:3,cursor:"pointer"}}>{d}</button>
                          ))}
                        </div>}
                        <input type="date" value={recurEndDate} onChange={e=>setRecurEndDate(e.target.value)} style={{padding:"0.2rem"}}/>
                      </div>
                    )}
                    <div style={{display:"flex",gap:"0.3rem"}}>
                      <button onClick={scheduleMsg} style={{padding:"0.2rem 0.6rem",background:"#4CAF50",color:"#fff",border:"none",borderRadius:4,cursor:"pointer",fontSize:"0.75rem"}}>Agendar</button>
                      <button onClick={()=>setShowSchedule(false)} style={{padding:"0.2rem 0.6rem",fontSize:"0.75rem",cursor:"pointer"}}>Cancelar</button>
                    </div>
                  </div>
                )}
                <div style={{ display:"flex", gap:"0.3rem" }}>
                  <input value={msgText} onChange={e=>setMsgText(e.target.value)}
                    onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();sendNow();}}}
                    placeholder="Mensagem..." style={{ flex:1, padding:"0.45rem 0.7rem", borderRadius:20, border:"1px solid #ccc" }}/>
                  <button onClick={sendNow} disabled={sending||!msgText.trim()}
                    style={{ padding:"0.45rem 0.7rem", background:"#25D366", color:"#fff", border:"none", borderRadius:20, cursor:"pointer" }}>
                    {sending?"...":"Enviar"}</button>
                  <button onClick={()=>setShowSchedule(!showSchedule)}
                    style={{ padding:"0.45rem", background:showSchedule?"#333":"#eee", color:showSchedule?"#fff":"#333", border:"none", borderRadius:20, cursor:"pointer" }}>⏰</button>
                </div>
              </div>
            </>) : (
              <div style={{ flex:1, display:"flex", alignItems:"center", justifyContent:"center", color:"#999" }}>Selecione uma conversa</div>
            )}
          </div>
        </div>
      ) : (
        <div style={{ padding:"1rem" }}>
          <div style={{ display:"flex", gap:"0.3rem", marginBottom:"1rem" }}>
            {[["pending","Pendentes"],["sent","Enviadas"],["failed","Falharam"],["cancelled","Canceladas"],["","Todas"]].map(([s,l])=>(
              <button key={s} onClick={()=>setSchedFilter(s)} style={{padding:"0.25rem 0.6rem",background:schedFilter===s?"#333":"#eee",color:schedFilter===s?"#fff":"#333",border:"none",borderRadius:4,cursor:"pointer",fontSize:"0.8rem"}}>{l}</button>
            ))}
          </div>
          {scheduledMsgs.length===0 ? <p style={{color:"#999"}}>Nenhuma agendada</p> :
            <table style={{width:"100%",borderCollapse:"collapse",fontSize:"0.8rem"}}>
              <thead><tr style={{borderBottom:"2px solid #333"}}>
                <th style={{textAlign:"left",padding:"0.3rem"}}>Dest.</th><th style={{textAlign:"left",padding:"0.3rem"}}>Msg</th>
                <th style={{textAlign:"left",padding:"0.3rem"}}>Para</th><th style={{textAlign:"center",padding:"0.3rem"}}>Status</th><th style={{padding:"0.3rem"}}>Ações</th>
              </tr></thead>
              <tbody>{scheduledMsgs.map(m=>(
                <tr key={m.id} style={{borderBottom:"1px solid #eee"}}>
                  <td style={{padding:"0.3rem"}}>{m.contact_name||m.recipient}</td>
                  <td style={{padding:"0.3rem",maxWidth:200,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{m.is_recurring&&"🔄 "}{m.content}</td>
                  <td style={{padding:"0.3rem",fontSize:"0.75rem"}}>{fmt(m.scheduled_at)}</td>
                  <td style={{padding:"0.3rem",textAlign:"center"}}><span style={{
                    padding:"0.1rem 0.3rem",borderRadius:10,fontSize:"0.65rem",
                    background:m.status==="sent"?"#e8f5e9":m.status==="failed"?"#ffebee":m.status==="cancelled"?"#f5f5f5":"#fff3e0",
                    color:m.status==="sent"?"#2e7d32":m.status==="failed"?"#c62828":m.status==="cancelled"?"#666":"#e65100"
                  }}>{m.status}</span></td>
                  <td style={{padding:"0.3rem"}}>
                    {m.status==="pending"&&<><button onClick={()=>sendSched(m.id)} style={{fontSize:"0.65rem",padding:"0.1rem 0.25rem",cursor:"pointer",marginRight:"0.15rem"}}>Enviar</button>
                      <button onClick={()=>cancelSched(m.id)} style={{fontSize:"0.65rem",padding:"0.1rem 0.25rem",cursor:"pointer",color:"orange"}}>Cancelar</button></>}
                    {m.status!=="pending"&&<button onClick={()=>delSched(m.id)} style={{fontSize:"0.65rem",padding:"0.1rem 0.25rem",cursor:"pointer",color:"red"}}>Excluir</button>}
                  </td>
                </tr>
              ))}</tbody>
            </table>}
        </div>
      )}
    </div>
  );
}

export default function ChatPage() {
  return <ErrorBoundary><ChatApp /></ErrorBoundary>;
}
