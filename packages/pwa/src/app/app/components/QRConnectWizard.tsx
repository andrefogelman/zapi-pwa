"use client";
import { useEffect, useState } from "react";
import QRCode from "react-qr-code";
import { getSupabaseBrowser } from "@/lib/supabase-browser";

type Step = "name" | "qr" | "connected" | "error";

type QRPayload = { qr: string; format: "string" | "png_base64" };

export function QRConnectWizard({
  onDoneAction,
}: {
  onDoneAction: (instanceId: string) => void;
}) {
  const [step, setStep] = useState<Step>("name");
  const [name, setName] = useState("");
  const [instanceId, setInstanceId] = useState<string | null>(null);
  const [qr, setQr] = useState<QRPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function getToken(): Promise<string> {
    const supabase = getSupabaseBrowser();
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) throw new Error("no session");
    return session.access_token;
  }

  async function handleCreate() {
    if (!name.trim()) return;
    try {
      const token = await getToken();

      const createRes = await fetch("/api/instances", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ name }),
      });
      if (!createRes.ok) throw new Error(await createRes.text());
      const instance = await createRes.json();
      setInstanceId(instance.id);

      // POST /auth triggers the WhatsApp connection and waits up to 20 s for
      // a QR code to become available. GET /qr only returns data AFTER auth
      // has been called, so calling it first would always return state=new.
      const authRes = await fetch(`/api/waclaw/sessions/${instance.waclaw_session_id}/auth`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
      });
      if (!authRes.ok) throw new Error(`Auth falhou (HTTP ${authRes.status})`);
      const authData = await authRes.json();
      if (!authData.qr) throw new Error("Nenhum QR code recebido do servidor");
      setQr({ qr: authData.qr, format: "string" });
      setStep("qr");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStep("error");
    }
  }

  // Poll status while the QR is on screen.
  useEffect(() => {
    if (step !== "qr" || !instanceId) return;
    let cancelled = false;
    const interval = setInterval(async () => {
      if (cancelled) return;
      try {
        const token = await getToken();
        const res = await fetch(`/api/instances/${instanceId}/status`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) return; // transient error — let the next tick retry
        const data = await res.json();
        if (data.connected || data.state === "connected") {
          setStep("connected");
          clearInterval(interval);
          setTimeout(() => onDoneAction(instanceId), 1500);
        }
      } catch {
        // swallow and retry on the next tick — the dev server may be slow
      }
    }, 2000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [step, instanceId, onDoneAction]);

  const container = {
    maxWidth: 400,
    margin: "2rem auto",
    padding: "2rem",
    border: "1px solid #ddd",
    borderRadius: 8,
    textAlign: "center" as const,
    fontFamily: "sans-serif",
  };

  if (step === "name") {
    return (
      <div style={container}>
        <h2>Conectar WhatsApp</h2>
        <p style={{ color: "#666" }}>Dê um nome pra essa linha</p>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Ex: Celular principal"
          style={{ width: "100%", padding: "0.5rem", marginBottom: "1rem" }}
          autoFocus
        />
        <button
          onClick={handleCreate}
          disabled={!name.trim()}
          style={{ padding: "0.5rem 1.5rem" }}
        >
          Continuar
        </button>
      </div>
    );
  }

  if (step === "qr" && qr) {
    return (
      <div style={container}>
        <h2>Escaneie com o WhatsApp</h2>
        <p style={{ color: "#666", fontSize: "0.9rem" }}>
          WhatsApp → Aparelhos conectados → Conectar aparelho
        </p>
        {qr.format === "string" ? (
          <div
            style={{
              background: "#fff",
              padding: 16,
              display: "inline-block",
            }}
          >
            <QRCode value={qr.qr} size={256} />
          </div>
        ) : (
          <img
            src={`data:image/png;base64,${qr.qr}`}
            alt="QR code"
            style={{ width: 256, height: 256 }}
          />
        )}
        <p style={{ color: "#999", marginTop: "1rem" }}>Aguardando conexão...</p>
      </div>
    );
  }

  if (step === "connected") {
    return (
      <div style={container}>
        <h2>✓ Conectado!</h2>
        <p>Carregando...</p>
      </div>
    );
  }

  // step === "error"
  return (
    <div style={container}>
      <h2>Erro</h2>
      <p style={{ color: "red" }}>{error}</p>
      <button
        onClick={() => {
          setError(null);
          setStep("name");
        }}
        style={{ padding: "0.5rem 1.5rem" }}
      >
        Tentar de novo
      </button>
    </div>
  );
}
