"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { useWaclaw } from "./useWaclaw";
import { useAuth } from "@/lib/use-auth";
import { getChatTab, type ChatTab } from "../lib/formatters";

export interface Chat {
  jid: string;
  name: string;
  kind: string;
  lastTs: number;
  lastMessage: string | null;
  lastSender: string | null;
  msgCount: number;
  isGroup: boolean;
  tab: ChatTab;
  profilePicUrl: string | null;
  hasAvatar: boolean;
  isUnread: boolean;
}

// localStorage key for last-read timestamp per chat
function readKey(sessionId: string, jid: string) {
  return `wa-read:${sessionId}:${jid}`;
}

export function useChats(sessionId: string | null) {
  const { fetcher, ready } = useWaclaw(sessionId);
  const { session } = useAuth();
  const [allChats, setAllChats] = useState<Chat[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [activeTab, setActiveTab] = useState<ChatTab>("all");

  useEffect(() => {
    if (!ready) return;
    setLoading(true);
    fetcher("chats").then((data) => {
      if (Array.isArray(data)) {
        const token = session?.access_token;
        const visible = (data as Record<string, unknown>[]).filter((c) => {
          const jid = c.jid as string;
          return !jid.includes("@newsletter") && jid !== "status@broadcast";
        });

        // On first load for this session, check if we have ANY read-tracking entries.
        // If none exist, this is the first time the user opens the app with this
        // session — initialize all chats as "read" so only future messages trigger
        // the unread indicator (avoids 78 chats all lighting up on first launch).
        const firstLoad = sessionId
          ? !visible.some((c) => localStorage.getItem(readKey(sessionId, c.jid as string)))
          : false;
        if (firstLoad && sessionId) {
          for (const c of visible) {
            const jid = c.jid as string;
            const ts = (c.lastTs as number) || 0;
            if (ts > 0) localStorage.setItem(readKey(sessionId, jid), String(ts));
          }
        }

        setAllChats(visible.map((c: Record<string, unknown>) => {
          const jid = c.jid as string;
          const hasAvatar = Boolean(c.hasAvatar);
          // Build authenticated URL to our avatar endpoint when one is cached
          const profilePicUrl = hasAvatar && sessionId && token
            ? `/api/waclaw/sessions/${sessionId}/avatar/${encodeURIComponent(jid)}?token=${encodeURIComponent(token)}`
            : (c.profilePicUrl as string) || null;
          const lastTs = (c.lastTs as number) || 0;
          const stored = sessionId ? localStorage.getItem(readKey(sessionId, jid)) : null;
          const lastReadTs = stored ? parseInt(stored, 10) : 0;
          return {
            jid,
            name: (c.name as string) || jid.split("@")[0],
            kind: (c.kind as string) || "unknown",
            lastTs,
            lastMessage: c.lastMessage as string | null,
            lastSender: c.lastSender as string | null,
            msgCount: (c.msgCount as number) || 0,
            isGroup: (c.isGroup as boolean) || false,
            tab: getChatTab((c.kind as string) || "unknown", jid),
            profilePicUrl,
            hasAvatar,
            isUnread: lastTs > lastReadTs,
          };
        }));
      }
      setLoading(false);
    });
  }, [ready, session?.access_token, sessionId]);

  const filtered = useMemo(() => {
    let result = allChats;
    if (activeTab !== "all") {
      result = result.filter((c) => c.tab === activeTab);
    }
    if (search) {
      const q = search.toLowerCase();
      result = result.filter((c) =>
        c.name.toLowerCase().includes(q) ||
        c.jid.includes(q) ||
        c.lastMessage?.toLowerCase().includes(q)
      );
    }
    return result;
  }, [allChats, activeTab, search]);

  const tabCounts = useMemo(() => ({
    all: allChats.length,
    dms: allChats.filter((c) => c.tab === "dms").length,
    groups: allChats.filter((c) => c.tab === "groups").length,
    channels: allChats.filter((c) => c.tab === "channels").length,
  }), [allChats]);

  // Call when user opens a chat — persists to localStorage and clears the badge
  const markAsRead = useCallback((jid: string) => {
    if (!sessionId) return;
    const now = Math.floor(Date.now() / 1000);
    localStorage.setItem(readKey(sessionId, jid), String(now));
    setAllChats((prev) =>
      prev.map((c) => (c.jid === jid ? { ...c, isUnread: false } : c))
    );
  }, [sessionId]);

  return { chats: filtered, loading, search, setSearch, activeTab, setActiveTab, tabCounts, markAsRead };
}
