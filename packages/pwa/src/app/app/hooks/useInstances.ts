"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/lib/use-auth";

export interface Instance {
  id: string;
  name: string;
  provider: "waclaw" | "zapi";
  zapi_instance_id: string | null;
  waclaw_session_id: string | null;
  status: string;
  connected_phone: string | null;
  sort_order?: number;
}

export function useInstances() {
  const { session } = useAuth();
  const [instances, setInstances] = useState<Instance[]>([]);
  const [loading, setLoading] = useState(true);

  const authHeaders = useCallback((): Record<string, string> => {
    const token = session?.access_token;
    const h: Record<string, string> = {};
    if (token) h.Authorization = `Bearer ${token}`;
    return h;
  }, [session?.access_token]);

  const reload = useCallback(async () => {
    if (!session?.access_token) return;
    setLoading(true);
    try {
      const res = await fetch("/api/instances", { headers: authHeaders() });
      const data = await res.json();
      if (Array.isArray(data)) setInstances(data);
    } finally {
      setLoading(false);
    }
  }, [session?.access_token, authHeaders]);

  useEffect(() => {
    if (session?.access_token) reload();
  }, [session?.access_token, reload]);

  const createWaclaw = useCallback(async (name: string): Promise<Instance | null> => {
    const res = await fetch("/api/instances", {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ name, provider: "waclaw" }),
    });
    if (!res.ok) return null;
    const inst = await res.json();
    await reload();
    return inst;
  }, [authHeaders, reload]);

  const remove = useCallback(async (id: string) => {
    const res = await fetch(`/api/instances/${id}`, {
      method: "DELETE",
      headers: authHeaders(),
    });
    if (res.ok) await reload();
    return res.ok;
  }, [authHeaders, reload]);

  const rename = useCallback(async (id: string, name: string) => {
    const res = await fetch(`/api/instances/${id}`, {
      method: "PATCH",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    if (res.ok) await reload();
    return res.ok;
  }, [authHeaders, reload]);

  const reorder = useCallback(
    async (newOrder: string[]) => {
      if (!session?.access_token) return;
      // Optimistic local reorder for instant feedback.
      setInstances((prev) => {
        const byId = new Map(prev.map((i) => [i.id, i]));
        return newOrder.map((id) => byId.get(id)!).filter(Boolean) as Instance[];
      });
      await fetch("/api/instances", {
        method: "PATCH",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ order: newOrder }),
      });
    },
    [session?.access_token, authHeaders],
  );

  return { instances, loading, reload, createWaclaw, remove, rename, reorder };
}
