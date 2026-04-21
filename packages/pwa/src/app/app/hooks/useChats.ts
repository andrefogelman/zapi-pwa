"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { useWaclaw } from "./useWaclaw";
import { useAuth } from "@/lib/use-auth";
import { getChatTab, type ChatTab } from "../lib/formatters";

export interface OtherContact {
  jid: string;
  lid: string | null;
  name: string;
  phone: string;
}

export interface Chat {
  jid: string;
  lid: string | null;
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
  pinned: boolean;
  manualUnread: boolean;
  mutedUntil: number;
  blocked: boolean;
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
  // searchInput = what's in the box (updates each keystroke, used for input value)
  // search = debounced version that drives filtering (200ms lag).
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  useEffect(() => {
    const h = setTimeout(() => setSearch(searchInput), 200);
    return () => clearTimeout(h);
  }, [searchInput]);
  const [activeTab, setActiveTab] = useState<ChatTab>("all");
  const [otherContacts, setOtherContacts] = useState<OtherContact[]>([]);

  const reloadChats = useCallback(() => {
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

        // Dedup phone+lid representations of the same contact. The backend
        // computes identityKey by following the phone↔lid pairing in the
        // contacts table (even with device :NN suffixes). Same key → same
        // contact even when display names differ (e.g. Fernando Setton /
        // Nando — full_name vs push_name). Keep the freshest row.
        const byIdentity = new Map<string, Record<string, unknown>>();
        for (const c of visible) {
          const key = (c.identityKey as string) || (c.jid as string);
          const ts = (c.lastTs as number) || 0;
          const existing = byIdentity.get(key);
          if (!existing || ((existing.lastTs as number) || 0) < ts) {
            byIdentity.set(key, c);
          }
        }
        const deduped = Array.from(byIdentity.values());
        setAllChats(deduped.map((c: Record<string, unknown>) => {
          const jid = c.jid as string;
          const hasAvatar = Boolean(c.hasAvatar);
          // Build authenticated URL to our avatar endpoint when one is cached
          const profilePicUrl = hasAvatar && sessionId && token
            ? `/api/waclaw/sessions/${sessionId}/avatar/${encodeURIComponent(jid)}?token=${encodeURIComponent(token)}`
            : (c.profilePicUrl as string) || null;
          const lastTs = (c.lastTs as number) || 0;
          const stored = sessionId ? localStorage.getItem(readKey(sessionId, jid)) : null;
          const lastReadTs = stored ? parseInt(stored, 10) : 0;
          const pinned = Boolean(c.pinned);
          const manualUnread = Boolean(c.manualUnread);
          const mutedUntil = typeof c.mutedUntil === "number" ? c.mutedUntil : 0;
          const blocked = Boolean(c.blocked);
          return {
            jid,
            lid: (c.lid as string) || null,
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
            isUnread: manualUnread || lastTs > lastReadTs,
            pinned,
            manualUnread,
            mutedUntil,
            blocked,
          };
        }));
      }
      setLoading(false);
    });
  }, [ready, fetcher, session?.access_token, sessionId]);

  useEffect(() => {
    reloadChats();
  }, [reloadChats]);

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
        c.lastMessage?.toLowerCase().includes(q),
      );
    }
    // Pinned always on top, then chronological. Sort runs against a copy so
    // the source array stays untouched for other consumers.
    return [...result].sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      return b.lastTs - a.lastTs;
    });
  }, [allChats, activeTab, search]);

  // When the user types a search term, also hit waclaw for address-book
  // contacts that don't have an active chat yet. Debounced 250ms.
  useEffect(() => {
    if (!search.trim() || !ready) {
      setOtherContacts([]);
      return;
    }
    const q = search.trim();
    let cancelled = false;
    const handle = setTimeout(async () => {
      try {
        const data = await fetcher(`contacts/search?q=${encodeURIComponent(q)}&limit=50`);
        if (cancelled || !Array.isArray(data)) return;
        const activeJids = new Set(allChats.map((c) => c.jid));
        const rows = (data as Record<string, unknown>[])
          .filter((c) => !activeJids.has(c.jid as string))
          .map((c) => ({
            jid: c.jid as string,
            lid: (c.lid as string) || null,
            name: (c.name as string) || (c.phone as string) || (c.jid as string).split("@")[0],
            phone: (c.phone as string) || "",
          }));
        setOtherContacts(rows);
      } catch {
        setOtherContacts([]);
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [search, ready, fetcher, allChats]);

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

  return {
    chats: filtered,
    loading,
    search: searchInput,
    setSearch: setSearchInput,
    activeTab, setActiveTab, tabCounts, markAsRead, reloadChats, otherContacts,
  };
}
