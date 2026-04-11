"use client";

import { useAuth } from "@/lib/use-auth";
import { useCallback } from "react";

export function useWaclaw(sessionId: string | null) {
  const { session } = useAuth();

  const fetcher = useCallback(async (path: string, options?: RequestInit) => {
    if (!sessionId || !session?.access_token) return null;
    const res = await fetch(`/api/waclaw/sessions/${sessionId}/${path}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        "Content-Type": "application/json",
        ...options?.headers,
      },
    });
    if (!res.ok) return null;
    return res.json();
  }, [sessionId, session?.access_token]);

  return { fetcher, ready: !!sessionId && !!session?.access_token };
}
