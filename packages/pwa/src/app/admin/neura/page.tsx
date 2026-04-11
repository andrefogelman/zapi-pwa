"use client";
import { useEffect, useState } from "react";
import { getSupabaseBrowser } from "@/lib/supabase-browser";

interface PlatformConfig {
  neura_prompt: string;
  neura_model: string;
  neura_temperature: number;
  neura_top_p: number;
}

const MODELS = ["gpt-4o", "gpt-4o-mini", "gpt-4.1", "gpt-4.1-mini", "whisper-1"];

export default function AdminNeuraPage() {
  const [config, setConfig] = useState<PlatformConfig | null>(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string>("");

  async function token() {
    const supabase = getSupabaseBrowser();
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) throw new Error("no session");
    return session.access_token;
  }

  useEffect(() => {
    (async () => {
      try {
        const t = await token();
        const res = await fetch("/api/admin/platform-config", {
          headers: { Authorization: `Bearer ${t}` },
        });
        if (res.ok) setConfig(await res.json());
      } catch (err) {
        setMsg(`Erro ao carregar: ${err instanceof Error ? err.message : String(err)}`);
      }
    })();
  }, []);

  async function save() {
    if (!config) return;
    setSaving(true);
    try {
      const t = await token();
      const res = await fetch("/api/admin/platform-config", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${t}`,
        },
        body: JSON.stringify({
          neura_prompt: config.neura_prompt,
          neura_model: config.neura_model,
          neura_temperature: config.neura_temperature,
          neura_top_p: config.neura_top_p,
        }),
      });
      setMsg(res.ok ? "Salvo!" : `Erro: ${await res.text()}`);
    } catch (err) {
      setMsg(`Erro: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSaving(false);
      setTimeout(() => setMsg(""), 3000);
    }
  }

  if (!config) return <div>Carregando...</div>;

  return (
    <div style={{ maxWidth: 700 }}>
      <h1>Neura</h1>

      <label>System Prompt</label>
      <textarea
        value={config.neura_prompt}
        onChange={(e) => setConfig({ ...config, neura_prompt: e.target.value })}
        style={{
          width: "100%",
          minHeight: 300,
          fontFamily: "monospace",
          fontSize: "0.85rem",
          padding: "0.5rem",
          marginBottom: "1rem",
        }}
      />

      <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 150 }}>
          <label>Modelo</label>
          <select
            value={config.neura_model}
            onChange={(e) => setConfig({ ...config, neura_model: e.target.value })}
            style={{ width: "100%", padding: "0.5rem" }}
          >
            {MODELS.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </div>
        <div style={{ flex: 1, minWidth: 150 }}>
          <label>Temperature ({config.neura_temperature})</label>
          <input
            type="range"
            min={0}
            max={2}
            step={0.1}
            value={config.neura_temperature}
            onChange={(e) =>
              setConfig({ ...config, neura_temperature: parseFloat(e.target.value) })
            }
            style={{ width: "100%" }}
          />
        </div>
        <div style={{ flex: 1, minWidth: 150 }}>
          <label>Top P ({config.neura_top_p})</label>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={config.neura_top_p}
            onChange={(e) =>
              setConfig({ ...config, neura_top_p: parseFloat(e.target.value) })
            }
            style={{ width: "100%" }}
          />
        </div>
      </div>

      <button
        onClick={save}
        disabled={saving}
        style={{ padding: "0.5rem 1rem", marginTop: "1.5rem" }}
      >
        {saving ? "Salvando..." : "Salvar"}
      </button>
      {msg && (
        <p style={{ color: msg.startsWith("Erro") ? "red" : "green", marginTop: "0.5rem" }}>
          {msg}
        </p>
      )}
    </div>
  );
}
