"use client";

import { useState, useEffect, useMemo } from "react";
import { useWaclaw } from "./useWaclaw";
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
}

export function useChats(sessionId: string | null) {
  const { fetcher, ready } = useWaclaw(sessionId);
  const [allChats, setAllChats] = useState<Chat[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [activeTab, setActiveTab] = useState<ChatTab>("all");

  useEffect(() => {
    if (!ready) return;
    setLoading(true);
    fetcher("chats").then((data) => {
      if (Array.isArray(data)) {
        setAllChats(data.map((c: Record<string, unknown>) => ({
          jid: c.jid as string,
          name: (c.name as string) || (c.jid as string).split("@")[0],
          kind: (c.kind as string) || "unknown",
          lastTs: c.lastTs as number,
          lastMessage: c.lastMessage as string | null,
          lastSender: c.lastSender as string | null,
          msgCount: (c.msgCount as number) || 0,
          isGroup: (c.isGroup as boolean) || false,
          tab: getChatTab((c.kind as string) || "unknown", c.jid as string),
        })));
      }
      setLoading(false);
    });
  }, [ready]);

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

  return { chats: filtered, loading, search, setSearch, activeTab, setActiveTab, tabCounts };
}
