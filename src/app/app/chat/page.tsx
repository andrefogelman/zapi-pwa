"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/lib/use-auth";

interface Instance {
  id: string;
  name: string;
  status: string;
  provider: string;
  waclaw_session_id: string | null;
}

interface Chat {
  // Unified format
  jid: string;
  name: string;
  isGroup: boolean;
  lastTs: number;
  lastMessage: string | null;
  unread: number;
}

export default function ChatListPage() {
  const { session } = useAuth();
  const [chats, setChats] = useState<Chat[]>([]);
  const [selectedInstance, setSelectedInstance] = useState<Instance | null>(null);
  const [instances, setInstances] = useState<Instance[]>([]);
  const [loading, setLoading] = useState(true);

  const headers: Record<string, string> = {
    Authorization: `Bearer ${session?.access_token}`,
  };

  useEffect(() => {
    if (!session) return;
    fetch("/api/instances", { headers })
      .then((r) => r.json())
      .then((data: Instance[]) => {
        setInstances(data);
        const connected = data.find((i) => i.status === "connected");
        setSelectedInstance(connected || data[0] || null);
      });
  }, [session]);

  useEffect(() => {
    if (!selectedInstance) return;
    loadChats();
  }, [selectedInstance]);

  async function loadChats() {
    setLoading(true);

    if (selectedInstance?.provider === "waclaw" && selectedInstance.waclaw_session_id) {
      // WaClaw: fetch from waclaw proxy
      const res = await fetch(
        `/api/waclaw/sessions/${selectedInstance.waclaw_session_id}/chats`,
        { headers }
      );
      if (res.ok) {
        const data = await res.json();
        setChats(data.map((c: Record<string, unknown>) => ({
          jid: c.jid as string,
          name: (c.name as string) || (c.jid as string).split("@")[0],
          isGroup: c.isGroup as boolean,
          lastTs: c.lastTs as number,
          lastMessage: c.lastMessage as string | null,
          unread: 0,
        })));
      }
    } else {
      // Z-API: fetch from /api/chats
      const res = await fetch(`/api/chats?instance_id=${selectedInstance?.id}`, { headers });
      if (res.ok) {
        const data = await res.json();
        setChats(data.map((c: Record<string, unknown>) => ({
          jid: c.phone as string,
          name: (c.name as string) || (c.phone as string),
          isGroup: c.isGroup as boolean,
          lastTs: c.lastMessageTime as number,
          lastMessage: null,
          unread: (c.unread as number) || 0,
        })));
      }
    }

    setLoading(false);
  }

  function formatTime(ts: number) {
    if (!ts) return "";
    const d = new Date(ts);
    const now = new Date();
    if (d.toDateString() === now.toDateString()) {
      return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
    }
    return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
  }

  const provider = selectedInstance?.provider || "zapi";

  return (
    <div style={{ display: "flex", height: "100%" }}>
      <div style={{ width: 350, borderRight: "1px solid #ddd", overflowY: "auto", background: "#fff" }}>
        {/* Instance selector */}
        {instances.length > 1 && (
          <div style={{ padding: "0.5rem", borderBottom: "1px solid #eee" }}>
            <select
              value={selectedInstance?.id || ""}
              onChange={(e) => setSelectedInstance(instances.find((i) => i.id === e.target.value) || null)}
              style={{ width: "100%", padding: "0.4rem" }}
            >
              {instances.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name} ({i.provider === "waclaw" ? "WaClaw" : "Z-API"})
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Provider badge */}
        <div style={{ padding: "0.3rem 1rem", background: provider === "waclaw" ? "#e8f5e9" : "#e3f2fd", fontSize: "0.75rem", color: "#555" }}>
          {provider === "waclaw" ? "WaClaw — Histórico completo" : "Z-API — Mensagens em tempo real"}
        </div>

        {loading && <p style={{ padding: "2rem", color: "#999", textAlign: "center" }}>Carregando conversas...</p>}
        {!loading && chats.length === 0 && <p style={{ padding: "2rem", color: "#999", textAlign: "center" }}>Nenhuma conversa</p>}

        {chats.map((chat) => (
          <a
            key={chat.jid}
            href={`/app/chat/${encodeURIComponent(chat.jid)}?provider=${provider}&session=${selectedInstance?.waclaw_session_id || ""}&instance=${selectedInstance?.id || ""}`}
            style={{
              display: "flex", padding: "0.75rem 1rem", borderBottom: "1px solid #f0f0f0",
              textDecoration: "none", color: "inherit", alignItems: "center", gap: "0.75rem",
            }}
          >
            <div style={{
              width: 40, height: 40, borderRadius: "50%",
              background: chat.isGroup ? "#25d366" : "#075e54",
              display: "flex", alignItems: "center", justifyContent: "center",
              color: "#fff", fontSize: "0.8rem", fontWeight: 600, flexShrink: 0,
            }}>
              {chat.name.charAt(0).toUpperCase()}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                <span style={{ fontWeight: 600, fontSize: "0.95rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {chat.name}
                </span>
                <span style={{ fontSize: "0.72rem", color: "#999", flexShrink: 0, marginLeft: "0.5rem" }}>
                  {formatTime(chat.lastTs)}
                </span>
              </div>
              <div style={{ fontSize: "0.82rem", color: "#667", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {chat.lastMessage || (chat.isGroup ? "Grupo" : chat.jid.split("@")[0])}
              </div>
            </div>
            {chat.unread > 0 && (
              <span style={{ background: "#25d366", color: "#fff", borderRadius: 12, padding: "0.1rem 0.5rem", fontSize: "0.72rem", fontWeight: 600 }}>
                {chat.unread}
              </span>
            )}
          </a>
        ))}
      </div>

      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", background: "#f0f2f5", color: "#999" }}>
        Selecione uma conversa
      </div>
    </div>
  );
}
