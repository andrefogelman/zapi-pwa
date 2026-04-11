"use client";
import { useEffect, useState } from "react";
import { getSupabaseBrowser } from "@/lib/supabase-browser";

export interface UserSettingsView {
  display_name: string | null;
  transcription_footer: string;
  role: "user" | "super_admin";
}

export function useUserSettings() {
  const [settings, setSettings] = useState<UserSettingsView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const supabase = getSupabaseBrowser();
    let cancelled = false;
    (async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) {
        if (!cancelled) setLoading(false);
        return;
      }
      try {
        const res = await fetch("/api/user-settings", {
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        if (!res.ok) throw new Error(await res.text());
        const data = await res.json();
        if (!cancelled) setSettings(data);
      } catch (err) {
        if (!cancelled) setError(String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function update(
    patch: Partial<Pick<UserSettingsView, "display_name" | "transcription_footer">>,
  ) {
    const supabase = getSupabaseBrowser();
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) throw new Error("no session");
    const res = await fetch("/api/user-settings", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify(patch),
    });
    if (!res.ok) throw new Error(await res.text());
    setSettings((s) => (s ? { ...s, ...patch } : s));
  }

  return { settings, loading, error, update };
}
