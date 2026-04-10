"use client";

import { useEffect, useState, useRef } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { useAuth } from "@/lib/use-auth";
import { useRealtime } from "@/lib/use-realtime";
import { getSupabaseBrowser } from "@/lib/supabase-browser";

interface Message {
  id: string;
  text: string | null;
  type: string;
  fromMe: boolean;
  senderName: string | null;
  timestamp: number | string;
  transcription?: { text: string; summary: string | null } | null;
}

export default function ChatThreadPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const chatJid = decodeURIComponent(params.chatJid as string);
  const provider = searchParams.get("provider") || "zapi";
  const waclawSession = searchParams.get("session") || "";
  const instanceId = searchParams.get("instance") || "";

  const { session } = useAuth();
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const bottomRef = useRef<HTMLDivElement>(null);

  const headers: Record<string, string> = {
    Authorization: `Bearer ${session?.access_token}`,
  };

  useEffect(() => {
    if (!session) return;
    loadMessages();
  }, [session, chatJid, provider]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function loadMessages() {
    setLoading(true);

    if (provider === "waclaw" && waclawSession) {
      // WaClaw: fetch from proxy
      const res = await fetch(
        `/api/waclaw/sessions/${waclawSession}/messages/${encodeURIComponent(chatJid)}?limit=100`,
        { headers }
      );
      if (res.ok) {
        const data = await res.json();
        setMessages(data.map((m: Record<string, unknown>) => ({
          id: m.id as string,
          text: m.text as string | null,
          type: m.type as string || "text",
          fromMe: m.fromMe as boolean,
          senderName: m.senderName as string | null,
          timestamp: m.timestamp as number,
          transcription: null,
        })));
      }
    } else {
      // Z-API / Supabase
      const supabase = getSupabaseBrowser();
      const { data } = await supabase
        .from("messages")
        .select(`id, text, type, from_me, sender, timestamp, status, transcriptions(text, summary)`)
        .eq("instance_id", instanceId)
        .eq("chat_jid", chatJid)
        .order("timestamp", { ascending: true })
        .limit(100);

      if (data) {
        setMessages(data.map((m: Record<string, unknown>) => ({
          id: m.id as string,
          text: m.text as string | null,
          type: m.type as string,
          fromMe: m.from_me as boolean,
          senderName: m.sender as string | null,
          timestamp: m.timestamp as string,
          transcription: Array.isArray(m.transcriptions) && (m.transcriptions as unknown[]).length > 0
            ? (m.transcriptions as { text: string; summary: string | null }[])[0]
            : null,
        })));
      }
    }

    setLoading(false);
  }

  // Realtime for Z-API instances
  useRealtime({
    table: "messages",
    filter: instanceId ? `instance_id=eq.${instanceId}` : undefined,
    event: "INSERT",
    onRecord: ({ new: msg }) => {
      if (provider === "zapi" && (msg as Record<string, unknown>).chat_jid === chatJid) {
        loadMessages();
      }
    },
  });

  function formatTs(ts: number | string) {
    const d = typeof ts === "number" ? new Date(ts) : new Date(ts);
    return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  }

  const chatName = chatJid.replace(/@.*/, "");

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {/* Header */}
      <div style={{
        padding: "0.75rem 1rem", background: "#ededed", borderBottom: "1px solid #ddd",
        display: "flex", justifyContent: "space-between", alignItems: "center",
      }}>
        <div>
          <span style={{ fontWeight: 600 }}>{chatName}</span>
          <span style={{
            marginLeft: "0.5rem", fontSize: "0.7rem", padding: "0.15rem 0.4rem",
            borderRadius: 8, background: provider === "waclaw" ? "#c8e6c9" : "#bbdefb",
          }}>
            {provider === "waclaw" ? "WaClaw" : "Z-API"}
          </span>
        </div>
        <span style={{ fontSize: "0.8rem", color: "#999" }}>{messages.length} msgs</span>
      </div>

      {/* Messages */}
      <div style={{ flex: 1, overflowY: "auto", padding: "1rem", background: "#e5ddd5" }}>
        {loading && <p style={{ textAlign: "center", color: "#999" }}>Carregando...</p>}

        {messages.map((msg) => (
          <div key={msg.id} style={{
            display: "flex",
            justifyContent: msg.fromMe ? "flex-end" : "flex-start",
            marginBottom: "0.5rem",
          }}>
            <div style={{
              maxWidth: "65%", padding: "0.5rem 0.75rem", borderRadius: 8,
              background: msg.fromMe ? "#dcf8c6" : "#fff",
              boxShadow: "0 1px 1px rgba(0,0,0,0.1)",
            }}>
              {!msg.fromMe && msg.senderName && (
                <div style={{ fontSize: "0.75rem", color: "#075e54", fontWeight: 600, marginBottom: 2 }}>
                  {msg.senderName}
                </div>
              )}

              {msg.type === "audio" ? (
                <div>
                  <div style={{ fontSize: "0.85rem", color: "#999", fontStyle: "italic" }}>Audio</div>
                  {msg.transcription && (
                    <div style={{ marginTop: 6, padding: "0.5rem", background: "rgba(0,0,0,0.04)", borderRadius: 4, fontSize: "0.85rem" }}>
                      <div>{msg.transcription.text}</div>
                      {msg.transcription.summary && (
                        <div style={{ fontSize: "0.78rem", color: "#555", borderTop: "1px solid rgba(0,0,0,0.08)", paddingTop: 4, marginTop: 4 }}>
                          <strong>Resumo:</strong> {msg.transcription.summary}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ) : (
                <div style={{ fontSize: "0.9rem", whiteSpace: "pre-wrap" }}>{msg.text}</div>
              )}

              <div style={{ fontSize: "0.68rem", color: "#999", textAlign: "right", marginTop: 2 }}>
                {formatTs(msg.timestamp)}
              </div>
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
