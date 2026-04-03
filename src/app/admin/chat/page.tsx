"use client";

import { useEffect, useState } from "react";

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

export default function ChatPage() {
  const [chats, setChats] = useState<Chat[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    loadChats();
  }, []);

  async function loadChats() {
    try {
      setLoading(true);
      const res = await fetch("/api/conversations?limit=200");
      const data = await res.json();
      if (data.chats) {
        setChats(data.chats);
        loadDetails(data.chats);
      } else {
        setError(data.error || "Erro ao carregar");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro");
    } finally {
      setLoading(false);
    }
  }

  async function loadDetails(chatList: Chat[]) {
    const CHUNK = 15;
    for (let i = 0; i < chatList.length; i += CHUNK) {
      const chunk = chatList.slice(i, i + CHUNK);
      const chatJids = chunk.map((c) => c.jid);
      const phones = chunk.filter((c) => !c.isGroup).map((c) => c.phone);
      try {
        const res = await fetch("/api/conversations/details", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chatJids, phones }),
        });
        if (!res.ok) continue;
        const data = await res.json();
        setChats((prev) => prev.map((c) => {
          const lm = data.lastMessages?.[c.jid];
          const photo = data.photos?.[c.phone];
          if (!lm && !photo) return c;
          return {
            ...c,
            lastMessage: lm || c.lastMessage,
            photo: photo || c.photo,
          };
        }));
      } catch { /* continue */ }
    }
  }

  return (
    <main style={{ maxWidth: 1000, margin: "0 auto", fontFamily: "sans-serif", padding: "1rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
        <h1 style={{ margin: 0 }}>Chat WhatsApp</h1>
        <a href="/admin" style={{ color: "#666" }}>← Admin</a>
      </div>

      {loading && <p>Carregando conversas...</p>}
      {error && <p style={{ color: "red" }}>{error}</p>}

      <p>{chats.length} conversas</p>

      {chats.slice(0, 20).map((c) => (
        <div key={c.jid} style={{ display: "flex", alignItems: "center", gap: "0.5rem", padding: "0.5rem", borderBottom: "1px solid #eee" }}>
          <div style={{
            width: 40, height: 40, borderRadius: "50%", flexShrink: 0,
            background: c.photo ? `url(${c.photo}) center/cover` : "#ccc",
            display: "flex", alignItems: "center", justifyContent: "center", color: "#fff",
          }}>
            {!c.photo && (c.isGroup ? "👥" : c.name.charAt(0).toUpperCase())}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <strong style={{ fontSize: "0.9rem" }}>{c.name}</strong>
              <span style={{ fontSize: "0.7rem", color: "#999" }}>{c.timeLabel}</span>
            </div>
            <div style={{ fontSize: "0.8rem", color: "#666", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {c.lastMessage?.text || ""}
            </div>
          </div>
          {c.unread > 0 && <span style={{ background: "#25D366", color: "#fff", borderRadius: "10px", padding: "0.1rem 0.4rem", fontSize: "0.7rem" }}>{c.unread}</span>}
        </div>
      ))}
    </main>
  );
}
