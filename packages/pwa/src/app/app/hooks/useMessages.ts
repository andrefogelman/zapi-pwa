"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { useWaclaw } from "./useWaclaw";
import { useAuth } from "@/lib/use-auth";
import { parseVCard } from "../lib/vcard";

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
  starred: boolean;
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
  // Also parse vCard payloads into structured contact data for rendering.
  const enrichMessage = useCallback((m: Message): Message => {
    let enriched: Message = { ...m, starred: m.starred ?? false };

    if (m.mediaUrl && sessionId && session?.access_token) {
      const isRelative = !m.mediaUrl.startsWith("http") && !m.mediaUrl.startsWith("/");
      if (isRelative) {
        enriched = {
          ...enriched,
          mediaUrl: `/api/waclaw/sessions/${sessionId}/${m.mediaUrl}?token=${encodeURIComponent(session.access_token)}`,
        };
      }
    }

    // Parse vCard if this looks like a contact message and we don't have
    // structured contact data yet. wacli currently drops these, but the
    // parser is in place for when that changes.
    if (!enriched.contact && (m.type === "vcard" || m.type === "contact")) {
      const parsed = parseVCard(m.text) || parseVCard(m.mediaCaption);
      if (parsed) enriched = { ...enriched, contact: parsed };
    }

    return enriched;
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
      starred: false,
    }]);
    setReplyTarget(null);
    setSending(false);
  }, [chatJid, fetcher, sending]);

  const sendFile = useCallback(async (file: File, caption?: string) => {
    if (!chatJid || sending) return;
    setSending(true);

    // Detect type from mime
    const mime = file.type || "application/octet-stream";
    let msgType = "document";
    if (mime.startsWith("image/")) msgType = "image";
    else if (mime.startsWith("video/")) msgType = "video";
    else if (mime.startsWith("audio/")) msgType = "audio";

    // Optimistic message
    const localId = `local-${Date.now()}`;
    setMessages((prev) => [...prev, {
      id: localId,
      chatJid,
      chatName: null,
      senderJid: null,
      senderName: null,
      timestamp: Date.now() / 1000,
      fromMe: true,
      text: caption || `[${file.name}]`,
      type: msgType,
      mediaCaption: caption || null,
      mediaUrl: null,
      filename: file.name,
      mimeType: mime,
      transcription: null,
      transcriptionStatus: null,
      contact: null,
      starred: false,
    }]);

    try {
      const dataBase64 = await fileToBase64(file);
      const result = await fetcher("send-file", {
        method: "POST",
        body: JSON.stringify({
          to: chatJid,
          filename: file.name,
          mimeType: mime,
          caption: caption || undefined,
          dataBase64,
        }),
      });
      if (!result || result.error || result.ok === false) {
        throw new Error(result?.error || "Send failed");
      }
    } catch (err) {
      // Roll back the optimistic message on failure
      setMessages((prev) => prev.filter((m) => m.id !== localId));
      setSending(false);
      throw err;
    }

    setReplyTarget(null);
    setSending(false);
  }, [chatJid, fetcher, sending]);

  // --- Starred messages hydration ---
  // On sessionId change, fetch the user's stars for this session and
  // merge into messages state as they arrive.
  const starsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!sessionId || !session?.access_token) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/starred?sessionId=${encodeURIComponent(sessionId)}`, {
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        if (!res.ok || cancelled) return;
        const data = await res.json();
        const starred: string[] = data?.starred || [];
        starsRef.current = new Set(starred);
        // Apply to any messages already loaded
        setMessages((prev) =>
          prev.map((m) => (starsRef.current.has(m.id) ? { ...m, starred: true } : m))
        );
      } catch {}
    })();
    return () => { cancelled = true; };
  }, [sessionId, session?.access_token]);

  // When new messages load, apply the starred set
  useEffect(() => {
    if (starsRef.current.size === 0) return;
    setMessages((prev) => {
      let changed = false;
      const next = prev.map((m) => {
        const shouldBeStarred = starsRef.current.has(m.id);
        if (shouldBeStarred !== !!m.starred) {
          changed = true;
          return { ...m, starred: shouldBeStarred };
        }
        return m;
      });
      return changed ? next : prev;
    });
  }, [messages.length]);

  const toggleStar = useCallback(async (msgId: string) => {
    if (!sessionId || !session?.access_token) return;
    const msg = messages.find((m) => m.id === msgId);
    if (!msg) return;
    const newStarred = !msg.starred;

    // Optimistic toggle
    if (newStarred) starsRef.current.add(msgId);
    else starsRef.current.delete(msgId);
    setMessages((prev) =>
      prev.map((m) => (m.id === msgId ? { ...m, starred: newStarred } : m))
    );

    try {
      await fetch("/api/starred", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          sessionId,
          msgId,
          chatJid: msg.chatJid,
          starred: newStarred,
        }),
      });
    } catch {
      // Rollback on failure
      if (newStarred) starsRef.current.delete(msgId);
      else starsRef.current.add(msgId);
      setMessages((prev) =>
        prev.map((m) => (m.id === msgId ? { ...m, starred: !newStarred } : m))
      );
    }
  }, [sessionId, session?.access_token, messages]);

  // --- Auto-transcription pipeline ---
  // On every message list change, scan for audio messages without a
  // transcription and fire /api/transcribe for each. Cached on the server
  // so repeat calls are cheap.
  const inFlightTranscriptions = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!sessionId || !session?.access_token) return;
    const token = session.access_token;

    // Bulk-hydrate cached transcriptions on first load of a chat
    const toHydrate = messages.filter(
      (m) => (m.type === "audio" || m.type === "ptt") && !m.transcription && !m.id.startsWith("local-")
    );
    if (toHydrate.length === 0) return;

    let cancelled = false;

    async function run() {
      // 1) Bulk GET of cached ones
      try {
        const res = await fetch(`/api/transcribe?sessionId=${encodeURIComponent(sessionId!)}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok && !cancelled) {
          const data = await res.json();
          const map: Record<string, string> = data?.transcriptions || {};
          if (Object.keys(map).length > 0) {
            setMessages((prev) =>
              prev.map((m) => {
                if (!map[m.id]) return m;
                if (m.transcription) return m;
                return { ...m, transcription: map[m.id], transcriptionStatus: "completed" };
              })
            );
          }
        }
      } catch {}

      if (cancelled) return;

      // 2) For each still-missing audio, fire a transcription request
      for (const m of toHydrate) {
        if (cancelled) return;
        if (inFlightTranscriptions.current.has(m.id)) continue;
        // Check against latest state by closing over current messages is
        // stale; we'll rely on the Set + server-side caching
        inFlightTranscriptions.current.add(m.id);

        // Mark as processing in UI
        setMessages((prev) =>
          prev.map((x) => (x.id === m.id ? { ...x, transcriptionStatus: "processing" } : x))
        );

        fetch("/api/transcribe", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ sessionId, msgId: m.id, chatJid: m.chatJid }),
        })
          .then(async (r) => {
            const data = await r.json().catch(() => ({}));
            if (cancelled) return;
            if (r.ok && data.text) {
              setMessages((prev) =>
                prev.map((x) =>
                  x.id === m.id
                    ? { ...x, transcription: data.text, transcriptionStatus: "completed" }
                    : x
                )
              );
            } else {
              setMessages((prev) =>
                prev.map((x) =>
                  x.id === m.id ? { ...x, transcriptionStatus: "failed" } : x
                )
              );
            }
          })
          .catch(() => {
            if (cancelled) return;
            setMessages((prev) =>
              prev.map((x) =>
                x.id === m.id ? { ...x, transcriptionStatus: "failed" } : x
              )
            );
          })
          .finally(() => {
            inFlightTranscriptions.current.delete(m.id);
          });
      }
    }

    run();
    return () => { cancelled = true; };
  }, [messages, sessionId, session?.access_token]);

  return {
    messages, loading, loadingOlder, hasOlder, sending,
    loadMessages, loadOlder, sendMessage, sendFile, toggleStar,
    replyTarget, setReplyTarget,
    initialLoad,
  };
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // Strip the "data:mime;base64," prefix
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(reader.error || new Error("File read failed"));
    reader.readAsDataURL(file);
  });
}
