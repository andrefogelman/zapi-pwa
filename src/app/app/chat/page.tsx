"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/lib/use-auth";

interface Chat {
  phone: string;
  name: string;
  isGroup: boolean;
  lastMessageTime: number;
  unread: number;
}

export default function ChatListPage() {
  const { session } = useAuth();
  const [chats, setChats] = useState<Chat[]>([]);
  const [selectedInstance, setSelectedInstance] = useState<string | null>(null);
  const [instances, setInstances] = useState<{ id: string; name: string; status: string }[]>([]);
  const [loading, setLoading] = useState(true);

  const headers: Record<string, string> = {
    Authorization: `Bearer ${session?.access_token}`,
  };

  useEffect(() => {
    if (!session) return;
    fetch("/api/instances", { headers })
      .then((r) => r.json())
      .then((data) => {
        setInstances(data);
        const connected = data.find((i: { status: string }) => i.status === "connected");
        if (connected) setSelectedInstance(connected.id);
        else if (data.length > 0) setSelectedInstance(data[0].id);
      });
  }, [session]);

  useEffect(() => {
    if (!selectedInstance) return;
    loadChats();
  }, [selectedInstance]);

  async function loadChats() {
    setLoading(true);
    const res = await fetch(`/api/chats?instance_id=${selectedInstance}`, { headers });
    if (res.ok) {
      setChats(await res.json());
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

  return (
    <div style={{ display: "flex", height: "100%" }}>
      {/* Sidebar: conversation list */}
      <div style={{
        width: 350, borderRight: "1px solid #ddd", overflowY: "auto",
        background: "#fff",
      }}>
        {/* Instance selector */}
        {instances.length > 1 && (
          <div style={{ padding: "0.5rem", borderBottom: "1px solid #eee" }}>
            <select
              value={selectedInstance || ""}
              onChange={(e) => setSelectedInstance(e.target.value)}
              style={{ width: "100%", padding: "0.4rem" }}
            >
              {instances.map((i) => (
                <option key={i.id} value={i.id}>{i.name}</option>
              ))}
            </select>
          </div>
        )}

        {loading && (
          <p style={{ padding: "2rem", color: "#999", textAlign: "center" }}>
            Carregando conversas...
          </p>
        )}

        {!loading && chats.length === 0 && (
          <p style={{ padding: "2rem", color: "#999", textAlign: "center" }}>
            Nenhuma conversa
          </p>
        )}

        {chats.map((chat) => (
          <a
            key={chat.phone}
            href={`/app/chat/${encodeURIComponent(chat.phone)}`}
            style={{
              display: "flex", padding: "0.75rem 1rem", borderBottom: "1px solid #f0f0f0",
              textDecoration: "none", color: "inherit", alignItems: "center", gap: "0.75rem",
            }}
          >
            {/* Avatar placeholder */}
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
                  {formatTime(chat.lastMessageTime)}
                </span>
              </div>
              <div style={{ fontSize: "0.82rem", color: "#667", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {chat.isGroup ? "Grupo" : chat.phone}
              </div>
            </div>
            {chat.unread > 0 && (
              <span style={{
                background: "#25d366", color: "#fff", borderRadius: 12,
                padding: "0.1rem 0.5rem", fontSize: "0.72rem", fontWeight: 600,
              }}>
                {chat.unread}
              </span>
            )}
          </a>
        ))}
      </div>

      {/* Placeholder */}
      <div style={{
        flex: 1, display: "flex", alignItems: "center", justifyContent: "center",
        background: "#f0f2f5", color: "#999",
      }}>
        Selecione uma conversa
      </div>
    </div>
  );
}
