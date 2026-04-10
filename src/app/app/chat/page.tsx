"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/lib/use-auth";
import { useRealtime } from "@/lib/use-realtime";
import { getSupabaseBrowser } from "@/lib/supabase-browser";

interface Conversation {
  chat_jid: string;
  last_message: string | null;
  last_type: string;
  last_time: string;
  unread: number;
}

export default function ChatListPage() {
  const { session } = useAuth();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedInstance, setSelectedInstance] = useState<string | null>(null);
  const [instances, setInstances] = useState<{ id: string; name: string }[]>([]);

  useEffect(() => {
    if (!session) return;
    fetch("/api/instances", {
      headers: { Authorization: `Bearer ${session.access_token}` },
    }).then((r) => r.json()).then((data) => {
      setInstances(data);
      if (data.length > 0) setSelectedInstance(data[0].id);
    });
  }, [session]);

  useEffect(() => {
    if (!selectedInstance) return;
    loadConversations();
  }, [selectedInstance]);

  async function loadConversations() {
    const supabase = getSupabaseBrowser();
    const { data } = await supabase
      .from("messages")
      .select("chat_jid, text, type, timestamp")
      .eq("instance_id", selectedInstance!)
      .order("timestamp", { ascending: false })
      .limit(200);

    if (!data) return;

    // Group by chat_jid, take most recent
    const map = new Map<string, Conversation>();
    for (const msg of data) {
      if (!map.has(msg.chat_jid)) {
        map.set(msg.chat_jid, {
          chat_jid: msg.chat_jid,
          last_message: msg.text,
          last_type: msg.type,
          last_time: msg.timestamp,
          unread: 0,
        });
      }
    }
    setConversations(Array.from(map.values()));
  }

  // Live updates
  useRealtime({
    table: "messages",
    filter: selectedInstance ? `instance_id=eq.${selectedInstance}` : undefined,
    event: "INSERT",
    onRecord: () => loadConversations(),
  });

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

        {conversations.length === 0 && (
          <p style={{ padding: "2rem", color: "#999", textAlign: "center" }}>
            Nenhuma conversa ainda
          </p>
        )}

        {conversations.map((conv) => (
          <a
            key={conv.chat_jid}
            href={`/app/chat/${encodeURIComponent(conv.chat_jid)}`}
            style={{
              display: "block", padding: "0.75rem 1rem", borderBottom: "1px solid #f0f0f0",
              textDecoration: "none", color: "inherit",
            }}
          >
            <div style={{ fontWeight: 600, fontSize: "0.95rem", marginBottom: 2 }}>
              {conv.chat_jid.replace(/@.*/, "")}
            </div>
            <div style={{ fontSize: "0.82rem", color: "#667", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {conv.last_type === "audio" ? "Audio" : (conv.last_message || "...")}
            </div>
          </a>
        ))}
      </div>

      {/* Placeholder for when no chat is selected */}
      <div style={{
        flex: 1, display: "flex", alignItems: "center", justifyContent: "center",
        background: "#f0f2f5", color: "#999",
      }}>
        Selecione uma conversa
      </div>
    </div>
  );
}
