"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/lib/use-auth";
import type { TaskConversation } from "./useTasks";
import type { Instance } from "./useInstances";

export interface LiveMessage {
  id: string;
  chatJid: string;
  chatName: string | null;
  senderName: string | null;
  timestamp: number;
  fromMe: boolean;
  text: string | null;
  type: string;
  mediaCaption: string | null;
}

/**
 * Fetches recent messages from every conversation linked to a task — while
 * the task is still open/in_progress. Once the task is resolved/closed the
 * hook stops fetching (but existing messages stay rendered).
 */
export function useTaskConversationMessages(
  conversations: TaskConversation[],
  instances: Instance[],
  taskStatus: string | undefined,
  limit = 30,
) {
  const { session } = useAuth();
  const [messages, setMessages] = useState<LiveMessage[]>([]);
  const [loading, setLoading] = useState(false);

  const active = taskStatus === "open" || taskStatus === "in_progress";
  const token = session?.access_token;

  useEffect(() => {
    if (!active || !token || conversations.length === 0) {
      setMessages([]);
      return;
    }
    let cancelled = false;
    setLoading(true);

    async function loadAll() {
      const all: LiveMessage[] = [];
      for (const conv of conversations) {
        const inst = instances.find((i) => i.id === conv.instance_id);
        if (!inst?.waclaw_session_id) continue;
        const url = `/api/waclaw/sessions/${inst.waclaw_session_id}/messages/${encodeURIComponent(conv.chat_jid)}?limit=${limit}`;
        try {
          const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
          if (!res.ok) continue;
          const data = await res.json();
          if (!Array.isArray(data)) continue;
          for (const m of data) {
            all.push({
              id: `${conv.id}:${m.id}`,
              chatJid: conv.chat_jid,
              chatName: conv.chat_name || m.chatName || null,
              senderName: m.senderName || null,
              timestamp: m.timestamp,
              fromMe: m.fromMe,
              text: m.text,
              type: m.type,
              mediaCaption: m.mediaCaption,
            });
          }
        } catch {
          // swallow per-conversation errors so one bad conv doesn't lose the others
        }
      }
      if (cancelled) return;
      all.sort((a, b) => a.timestamp - b.timestamp);
      setMessages(all);
      setLoading(false);
    }

    loadAll();
    const interval = setInterval(loadAll, 30000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [active, token, conversations, instances, limit]);

  return { messages, loading };
}
