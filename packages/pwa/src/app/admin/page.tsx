"use client";
import { useEffect, useState } from "react";
import { getSupabaseBrowser } from "@/lib/supabase-browser";

interface Stats {
  total_users: number;
  connected_instances: number;
  transcribed_today: number;
  failed_today: number;
}

export default function AdminDashboard() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const supabase = getSupabaseBrowser();
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) return;
      try {
        const res = await fetch("/api/admin/stats", {
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        if (!res.ok) throw new Error(await res.text());
        setStats(await res.json());
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    })();
  }, []);

  if (error) return <div style={{ color: "red" }}>{error}</div>;
  if (!stats) return <div>Carregando...</div>;

  const cards: Array<{ label: string; value: number; red?: boolean }> = [
    { label: "Usuários", value: stats.total_users },
    { label: "Instâncias conectadas", value: stats.connected_instances },
    { label: "Transcrições hoje", value: stats.transcribed_today },
    { label: "Falhas hoje", value: stats.failed_today, red: stats.failed_today > 0 },
  ];

  return (
    <div>
      <h1>Dashboard</h1>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
          gap: "1rem",
          marginTop: "1.5rem",
        }}
      >
        {cards.map((c) => (
          <div
            key={c.label}
            style={{
              padding: "1.5rem",
              background: "#fff",
              borderRadius: 8,
              border: "1px solid #ddd",
            }}
          >
            <div style={{ color: "#666", fontSize: "0.85rem" }}>{c.label}</div>
            <div
              style={{
                fontSize: "2rem",
                fontWeight: "bold",
                color: c.red ? "#c00" : "#333",
                marginTop: "0.5rem",
              }}
            >
              {c.value}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
