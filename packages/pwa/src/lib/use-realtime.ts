"use client";

import { useEffect, useRef } from "react";
import { getSupabaseBrowser } from "./supabase-browser";
import type { RealtimeChannel } from "@supabase/supabase-js";

interface RealtimeOptions {
  table: string;
  filter?: string;
  event?: "INSERT" | "UPDATE" | "DELETE" | "*";
  onRecord: (payload: { new: Record<string, unknown>; old: Record<string, unknown>; eventType: string }) => void;
}

export function useRealtime({ table, filter, event = "*", onRecord }: RealtimeOptions) {
  const channelRef = useRef<RealtimeChannel | null>(null);

  useEffect(() => {
    const supabase = getSupabaseBrowser();
    const channelName = `realtime:${table}:${filter || "all"}`;

    interface PgChangePayload {
      new: Record<string, unknown>;
      old: Record<string, unknown>;
      eventType: string;
    }
    const channel = supabase.channel(channelName).on(
      "postgres_changes" as never,
      { event, schema: "public", table, filter },
      (payload: PgChangePayload) => {
        onRecord({
          new: payload.new,
          old: payload.old,
          eventType: payload.eventType,
        });
      }
    ).subscribe();

    channelRef.current = channel;

    return () => {
      supabase.removeChannel(channel);
    };
  }, [table, filter, event]);
}
