"use client";

import { useEffect, useState, useRef } from "react";
import { useParams } from "next/navigation";
import { useAuth } from "@/lib/use-auth";
import { useRealtime } from "@/lib/use-realtime";
import { getSupabaseBrowser } from "@/lib/supabase-browser";

interface Transcription {
  text: string;
  summary: string | null;
}

interface Message {
  id: string;
  text: string | null;
  type: string;
  from_me: boolean;
  sender: string;
  timestamp: string;
  status: string;
  transcription: Transcription | null;
}

export default function ChatThreadPage() {
  const params = useParams();
  const chatJid = decodeURIComponent(params.chatJid as string);
  const { session } = useAuth();
  const [messages, setMessages] = useState<Message[]>([]);
  const [instanceId, setInstanceId] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!session) return;
    fetch("/api/instances", {
      headers: { Authorization: `Bearer ${session.access_token}` },
    }).then((r) => r.json()).then((data: { id: string }[]) => {
      if (data.length > 0) setInstanceId(data[0].id);
    });
  }, [session]);

  useEffect(() => {
    if (!instanceId) return;
    loadMessages();
  }, [instanceId, chatJid]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function loadMessages() {
    const supabase = getSupabaseBrowser();
    const { data } = await supabase
      .from("messages")
      .select(`
        id, text, type, from_me, sender, timestamp, status,
        transcriptions(text, summary)
      `)
      .eq("instance_id", instanceId!)
      .eq("chat_jid", chatJid)
      .order("timestamp", { ascending: true })
      .limit(100);

    if (data) {
      setMessages(data.map((m: Record<string, unknown>) => ({
        id: m.id as string,
        text: m.text as string | null,
        type: m.type as string,
        from_me: m.from_me as boolean,
        sender: m.sender as string,
        timestamp: m.timestamp as string,
        status: m.status as string,
        transcription: Array.isArray(m.transcriptions) && m.transcriptions.length > 0
          ? m.transcriptions[0] as Transcription
          : null,
      })));
    }
  }

  // Live new messages
  useRealtime({
    table: "messages",
    filter: instanceId ? `instance_id=eq.${instanceId}` : undefined,
    event: "INSERT",
    onRecord: ({ new: msg }) => {
      if ((msg as Record<string, unknown>).chat_jid === chatJid) loadMessages();
    },
  });

  // Live transcription updates
  useRealtime({
    table: "transcriptions",
    filter: instanceId ? `instance_id=eq.${instanceId}` : undefined,
    event: "INSERT",
    onRecord: () => loadMessages(),
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {/* Header */}
      <div style={{
        padding: "0.75rem 1rem", background: "#ededed", borderBottom: "1px solid #ddd",
        fontWeight: 600,
      }}>
        {chatJid.replace(/@.*/, "")}
      </div>

      {/* Messages */}
      <div style={{
        flex: 1, overflowY: "auto", padding: "1rem",
        background: "#e5ddd5",
      }}>
        {messages.map((msg) => (
          <div key={msg.id} style={{
            display: "flex",
            justifyContent: msg.from_me ? "flex-end" : "flex-start",
            marginBottom: "0.5rem",
          }}>
            <div style={{
              maxWidth: "65%", padding: "0.5rem 0.75rem", borderRadius: 8,
              background: msg.from_me ? "#dcf8c6" : "#fff",
              boxShadow: "0 1px 1px rgba(0,0,0,0.1)",
            }}>
              {!msg.from_me && (
                <div style={{ fontSize: "0.75rem", color: "#075e54", fontWeight: 600, marginBottom: 2 }}>
                  {msg.sender}
                </div>
              )}

              {msg.type === "audio" ? (
                <div>
                  <div style={{ fontSize: "0.85rem", color: "#999", fontStyle: "italic" }}>
                    Audio
                  </div>
                  {msg.status === "pending_transcription" && (
                    <div style={{ fontSize: "0.78rem", color: "#f90", marginTop: 4 }}>
                      Transcrevendo...
                    </div>
                  )}
                  {msg.transcription && (
                    <div style={{
                      marginTop: 6, padding: "0.5rem", background: "rgba(0,0,0,0.04)",
                      borderRadius: 4, fontSize: "0.85rem",
                    }}>
                      <div style={{ marginBottom: 4 }}>{msg.transcription.text}</div>
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
                {new Date(msg.timestamp).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
              </div>
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
