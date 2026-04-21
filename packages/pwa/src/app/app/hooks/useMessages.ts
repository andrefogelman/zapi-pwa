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
  reactions?: { emoji: string; count: number }[];
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
  // Incremented on each loadMessages call so stale async responses from a
  // previous chat don't overwrite the current one.
  const fetchVersionRef = useRef(0);
  // In-memory per-chat buffer: survives chat switches so reopening a chat
  // renders instantly with the last-known messages while the refresh fetch
  // runs in the background. Keyed by chatJid; lives as long as the hook
  // instance (i.e. until the user navigates away from /app or reloads).
  const cacheRef = useRef<Map<string, Message[]>>(new Map());

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
    const version = ++fetchVersionRef.current;
    // Serve from the cache immediately so returning to a chat doesn't flash
    // a spinner. The network fetch still runs to catch anything new.
    const cached = cacheRef.current.get(chatJid);
    if (cached && cached.length > 0) {
      setMessages(cached);
      setLoading(false);
    } else {
      setMessages([]);
      setLoading(true);
    }
    setHasOlder(true);
    initialLoad.current = true;
    const data = await fetcher(`messages/${encodeURIComponent(chatJid)}?limit=80`);
    // Discard response if the user has already switched to another chat.
    if (version !== fetchVersionRef.current) return;
    if (Array.isArray(data)) {
      const enriched = data.map(enrichMessage);
      setMessages(enriched);
      cacheRef.current.set(chatJid, enriched);
    }
    setLoading(false);
  }, [chatJid, fetcher, enrichMessage]);

  const loadOlder = useCallback(async () => {
    if (!chatJid || loadingOlder || !hasOlder || messages.length === 0) return;
    setLoadingOlder(true);
    const oldest = messages[0]?.timestamp;
    const local = await fetcher(`messages/${encodeURIComponent(chatJid)}?limit=50&before=${oldest}`);
    if (Array.isArray(local) && local.length > 0) {
      setMessages((prev) => [...local.map(enrichMessage), ...prev]);
      setLoadingOlder(false);
      return;
    }
    // Local store empty for this range — ask waclaw to pull older messages
    // from the WhatsApp history sync protocol, then retry the local query.
    // Backfill is async: the server responds when the request is sent, but the
    // history arrives over the socket. Give it ~2s then retry once.
    await fetcher(`backfill/${encodeURIComponent(chatJid)}?count=50`, { method: "POST" });
    await new Promise((r) => setTimeout(r, 2000));
    const retry = await fetcher(`messages/${encodeURIComponent(chatJid)}?limit=50&before=${oldest}`);
    if (Array.isArray(retry) && retry.length > 0) {
      setMessages((prev) => [...retry.map(enrichMessage), ...prev]);
    } else {
      setHasOlder(false);
    }
    setLoadingOlder(false);
  }, [chatJid, fetcher, loadingOlder, hasOlder, messages, enrichMessage]);

  const sendMessage = useCallback(async (text: string, quote?: ReplyTarget | null) => {
    if (!chatJid || !text.trim() || sending) return;
    setSending(true);
    const payload: Record<string, string> = { to: chatJid, message: text };
    if (quote?.id) payload.quotedMsgId = quote.id;
    await fetcher("send", {
      method: "POST",
      body: JSON.stringify(payload),
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
      transcriptionStatus: msgType === "audio" ? "processing" : null,
      contact: null,
      starred: false,
    }]);

    let realMsgId: string | null = null;
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
      if (typeof result.id === "string" && result.id) realMsgId = result.id;
    } catch (err) {
      // Roll back the optimistic message on failure
      setMessages((prev) => prev.filter((m) => m.id !== localId));
      setSending(false);
      throw err;
    }

    // For audio, transcribe the local bytes in background and splice the
    // result into the optimistic message. Pass the real waclaw msgId so
    // the server can persist to waclaw_transcriptions — on reload or from
    // another device the confirmed audio message will hydrate its
    // transcription from the cache.
    if (msgType === "audio" && session?.access_token) {
      const token = session.access_token;
      const persistMsgId = realMsgId;
      const persistSessionId = sessionId;
      (async () => {
        try {
          const fd = new FormData();
          fd.append("audio", file);
          if (persistSessionId && persistMsgId) {
            fd.append("sessionId", persistSessionId);
            fd.append("msgId", persistMsgId);
          }
          const res = await fetch("/api/transcribe-raw", {
            method: "POST",
            headers: { Authorization: `Bearer ${token}` },
            body: fd,
          });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const data = await res.json();
          if (!data?.text) throw new Error("no text returned");
          setMessages((prev) =>
            prev.map((m) =>
              m.id === localId
                ? { ...m, transcription: data.text, transcriptionStatus: "completed" }
                : m
            )
          );
        } catch {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === localId ? { ...m, transcriptionStatus: "failed" } : m
            )
          );
        }
      })();
    }

    setReplyTarget(null);
    setSending(false);
  }, [chatJid, fetcher, sending, session?.access_token, sessionId]);

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

  // Optimistic delete. Removes from the list immediately, rolls back the
  // message into its original position if the server rejects the revoke.
  const deleteMessage = useCallback(async (msg: Message) => {
    if (!sessionId || !session?.access_token) return;
    const senderJid = msg.senderJid || msg.chatJid;
    let restore: { idx: number; msg: Message } | null = null;
    setMessages((prev) => {
      const idx = prev.findIndex((m) => m.id === msg.id);
      if (idx < 0) return prev;
      restore = { idx, msg: prev[idx] };
      return [...prev.slice(0, idx), ...prev.slice(idx + 1)];
    });
    try {
      const res = await fetch(`/api/waclaw/sessions/${sessionId}/delete`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          chatJid: msg.chatJid,
          msgId: msg.id,
          senderJid,
          fromMe: msg.fromMe,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body?.ok) {
        throw new Error(body?.error || `HTTP ${res.status}`);
      }
    } catch (err) {
      // Restore the message at its original position.
      if (restore) {
        const r = restore as { idx: number; msg: Message };
        setMessages((prev) => [...prev.slice(0, r.idx), r.msg, ...prev.slice(r.idx)]);
      }
      throw err;
    }
  }, [sessionId, session?.access_token]);

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

  // Only react to changes in the number of messages (new arrivals or chat
  // switch), not to transcription status updates — otherwise every completed
  // transcription would re-trigger the effect and cause a cascade of GETs.
  // eslint-disable-next-line react-hooks/exhaustive-deps
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
  }, [messages.length, sessionId, session?.access_token]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep a ref to the current messages so the polling effect can read the
  // latest ts without having `messages` in its dep list — re-creating the
  // interval on every setMessages was causing a runaway loop.
  const messagesRef = useRef<Message[]>([]);
  useEffect(() => {
    messagesRef.current = messages;
    // Write-through to the per-chat cache so newer/older messages picked up
    // by polling, loadOlder, send, and delete all persist across switches.
    if (chatJid) cacheRef.current.set(chatJid, messages);
  }, [messages, chatJid]);

  // --- Poll for new messages every 3s ---
  // Pauses when tab is hidden so battery/quota aren't burned on background.
  useEffect(() => {
    if (!chatJid || loading) return;
    const POLL_MS = 3000;
    let id: ReturnType<typeof setInterval> | null = null;

    const tick = async () => {
      const current = messagesRef.current;
      let latestTs = 0;
      for (let i = current.length - 1; i >= 0; i--) {
        const m = current[i];
        if (!m.id.startsWith("local-")) {
          latestTs = Math.floor(m.timestamp);
          break;
        }
      }
      if (latestTs === 0) return;

      const data = await fetcher(
        `messages/${encodeURIComponent(chatJid)}?limit=50&after=${latestTs}`
      );
      if (!Array.isArray(data) || data.length === 0) return;

      setMessages((prev) => {
        const existingIds = new Set(prev.map((m) => m.id));
        const newMsgs = data
          .map(enrichMessage)
          .filter((m: Message) => !existingIds.has(m.id));
        if (newMsgs.length === 0) return prev;
        const cleaned = prev.filter((m) => {
          if (!m.id.startsWith("local-")) return true;
          return !newMsgs.some(
            (n: Message) => n.fromMe && Math.abs(n.timestamp - m.timestamp) < 5,
          );
        });
        return [...cleaned, ...newMsgs];
      });
    };

    const start = () => {
      if (id == null) id = setInterval(tick, POLL_MS);
    };
    const stop = () => {
      if (id != null) { clearInterval(id); id = null; }
    };
    const onVisibility = () => { document.hidden ? stop() : start(); };

    if (!document.hidden) start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [chatJid, loading, fetcher, enrichMessage]);

  return {
    messages, loading, loadingOlder, hasOlder, sending,
    loadMessages, loadOlder, sendMessage, sendFile, toggleStar, deleteMessage,
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
