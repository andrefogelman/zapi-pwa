"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/lib/use-auth";

export interface ThreadItem {
  id: string;
  source: "wa_group" | "internal_comment";
  body: string | null;
  senderName: string | null;
  fromMe: boolean;
  timestamp: number;
  mediaUrl?: string | null;
  mediaType?: string | null;
}

/**
 * Pulls the combined thread (WA group msgs + internal comments) for a task.
 * Polls every 5s while the task status is active. Returns items sorted
 * chronologically ascending.
 */
export function useTaskThread(taskId: string | null, taskStatus: string | undefined) {
  const { session } = useAuth();
  const [items, setItems] = useState<ThreadItem[]>([]);
  const [groupJid, setGroupJid] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const active = taskStatus === "open" || taskStatus === "in_progress";

  const load = useCallback(async () => {
    if (!taskId || !session?.access_token) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/tasks/${taskId}/thread`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (!res.ok) return;
      const data = await res.json();
      setItems(data.items ?? []);
      setGroupJid(data.group_jid ?? null);
    } finally {
      setLoading(false);
    }
  }, [taskId, session?.access_token]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!taskId || !active) return;
    const id = setInterval(() => {
      if (document.hidden) return;
      load();
    }, 5000);
    return () => clearInterval(id);
  }, [taskId, active, load]);

  const post = useCallback(
    async (body: string, visibility: "all" | "internal") => {
      if (!taskId || !session?.access_token || !body.trim()) return;
      await fetch(`/api/tasks/${taskId}/thread`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ body: body.trim(), visibility }),
      });
      await load();
    },
    [taskId, session?.access_token, load],
  );

  return { items, groupJid, loading, post, reload: load };
}
