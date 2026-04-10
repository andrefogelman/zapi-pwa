"use client";

import { useState, useCallback, useRef } from "react";
import { useWaclaw } from "./useWaclaw";
import { useAuth } from "@/lib/use-auth";

export interface Message {
  id: string;
  chatJid: string;
  chatName: string | null;
  senderJid: string | null;
  senderName: string | null;
  timestamp: number;
  fromMe: boolean;
  text: string | null;
  type: string;
  mediaCaption: string | null;
  mediaUrl: string | null;
  filename: string | null;
  mimeType: string | null;
  transcription: string | null;
  transcriptionStatus: string | null;
  contact: MessageContact | null;
}

export interface MessageContact {
  displayName: string;
  phones: { phone: string; type?: string }[];
  emails?: { email: string }[];
  organization?: string;
}

export interface ReplyTarget {
  id: string;
  senderName: string | null;
  text: string | null;
  fromMe: boolean;
}

export function useMessages(sessionId: string | null, chatJid: string | null) {
  const { fetcher } = useWaclaw(sessionId);
  const { session } = useAuth();
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [hasOlder, setHasOlder] = useState(true);
  const [sending, setSending] = useState(false);
  const [replyTarget, setReplyTarget] = useState<ReplyTarget | null>(null);
  const initialLoad = useRef(true);

  // Rewrite relative mediaUrl ("media/:jid/:msgId") into a full proxy URL
  // with the user's access token so <audio>/<img> src can hit it directly.
  const enrichMessage = useCallback((m: Message): Message => {
    if (!m.mediaUrl || !sessionId || !session?.access_token) return m;
    // Already an absolute URL — leave untouched
    if (m.mediaUrl.startsWith("http") || m.mediaUrl.startsWith("/")) return m;
    return {
      ...m,
      mediaUrl: `/api/waclaw/sessions/${sessionId}/${m.mediaUrl}?token=${encodeURIComponent(session.access_token)}`,
    };
  }, [sessionId, session?.access_token]);

  const loadMessages = useCallback(async () => {
    if (!chatJid) return;
    setLoading(true);
    setHasOlder(true);
    initialLoad.current = true;
    const data = await fetcher(`messages/${encodeURIComponent(chatJid)}?limit=80`);
    if (Array.isArray(data)) setMessages(data.map(enrichMessage));
    setLoading(false);
  }, [chatJid, fetcher, enrichMessage]);

  const loadOlder = useCallback(async () => {
    if (!chatJid || loadingOlder || !hasOlder || messages.length === 0) return;
    setLoadingOlder(true);
    const oldest = messages[0]?.timestamp;
    const data = await fetcher(`messages/${encodeURIComponent(chatJid)}?limit=50&before=${oldest}`);
    if (Array.isArray(data)) {
      if (data.length === 0) setHasOlder(false);
      else setMessages((prev) => [...data.map(enrichMessage), ...prev]);
    }
    setLoadingOlder(false);
  }, [chatJid, fetcher, loadingOlder, hasOlder, messages, enrichMessage]);

  const sendMessage = useCallback(async (text: string) => {
    if (!chatJid || !text.trim() || sending) return;
    setSending(true);
    await fetcher("send", {
      method: "POST",
      body: JSON.stringify({ to: chatJid, message: text }),
    });
    setMessages((prev) => [...prev, {
      id: `local-${Date.now()}`,
      chatJid,
      chatName: null,
      senderJid: null,
      senderName: null,
      timestamp: Date.now() / 1000,
      fromMe: true,
      text,
      type: "text",
      mediaCaption: null,
      mediaUrl: null,
      filename: null,
      mimeType: null,
      transcription: null,
      transcriptionStatus: null,
      contact: null,
    }]);
    setReplyTarget(null);
    setSending(false);
  }, [chatJid, fetcher, sending]);

  return {
    messages, loading, loadingOlder, hasOlder, sending,
    loadMessages, loadOlder, sendMessage,
    replyTarget, setReplyTarget,
    initialLoad,
  };
}
