"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/lib/use-auth";

interface Instance {
  id: string;
  name: string;
  zapi_instance_id: string;
  status: string;
  connected_phone: string | null;
}

export default function InstancesPage() {
  const { session } = useAuth();
  const [instances, setInstances] = useState<Instance[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: "", zapi_instance_id: "", zapi_token: "", zapi_client_token: "" });
  const [qrData, setQrData] = useState<{ instanceId: string; qr: string } | null>(null);
  const [msg, setMsg] = useState("");

  const headers: Record<string, string> = {
    Authorization: `Bearer ${session?.access_token}`,
    "Content-Type": "application/json",
  };

  useEffect(() => {
    if (session) loadInstances();
  }, [session]);

  async function loadInstances() {
    const res = await fetch("/api/instances", { headers });
    if (res.ok) setInstances(await res.json());
  }

  async function createInstance(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const res = await fetch("/api/instances", {
      method: "POST", headers,
      body: JSON.stringify(form),
    });
    if (res.ok) {
      setShowForm(false);
      setForm({ name: "", zapi_instance_id: "", zapi_token: "", zapi_client_token: "" });
      loadInstances();
    } else {
      setMsg((await res.json()).error);
    }
  }

  async function connectInstance(instanceId: string) {
    setMsg("Gerando QR Code...");
    const res = await fetch("/api/instances/qr", {
      method: "POST", headers,
      body: JSON.stringify({ instance_id: instanceId }),
    });
    if (res.ok) {
      const data = await res.json();
      // Z-API returns { connected: true } if already connected
      if (data.connected) {
        setMsg("Já conectado!");
        loadInstances();
        return;
      }
      // Z-API returns { value: "data:image/png;base64,..." } for QR
      const qrValue = data.value || data.qrcode || "";
      if (!qrValue) {
        setMsg("Erro: QR code vazio na resposta");
        return;
      }
      const qrSrc = qrValue.startsWith("data:") ? qrValue : `data:image/png;base64,${qrValue}`;
      setQrData({ instanceId, qr: qrSrc });
      setMsg("Escaneie o QR Code no WhatsApp");
      pollStatus(instanceId);
    } else {
      const errData = await res.json().catch(() => ({}));
      setMsg(`Erro: ${errData.error || res.statusText}`);
    }
  }

  async function pollStatus(instanceId: string) {
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 3000));
      const res = await fetch(`/api/instances/qr?instance_id=${instanceId}`, { headers });
      if (res.ok) {
        const data = await res.json();
        if (data.connected) {
          setQrData(null);
          setMsg("Conectado!");
          loadInstances();
          return;
        }
      }
    }
    setMsg("Timeout - tente novamente");
    setQrData(null);
  }

  const inputStyle: React.CSSProperties = { display: "block", width: "100%", padding: "0.5rem", marginBottom: "0.5rem", boxSizing: "border-box" };

  return (
    <div style={{ maxWidth: 600, margin: "1.5rem auto", padding: "0 1rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
        <h2 style={{ margin: 0 }}>Instâncias WhatsApp</h2>
        <button onClick={() => setShowForm(!showForm)} style={{ padding: "0.5rem 1rem", background: "#075e54", color: "#fff", border: "none", borderRadius: 4, cursor: "pointer" }}>
          + Nova
        </button>
      </div>

      {showForm && (
        <form onSubmit={createInstance} style={{ border: "1px solid #ddd", borderRadius: 4, padding: "1rem", marginBottom: "1rem" }}>
          <input placeholder="Nome" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} style={inputStyle} />
          <input placeholder="Z-API Instance ID" value={form.zapi_instance_id} onChange={(e) => setForm({ ...form, zapi_instance_id: e.target.value })} required style={inputStyle} />
          <input placeholder="Z-API Token" value={form.zapi_token} onChange={(e) => setForm({ ...form, zapi_token: e.target.value })} required style={inputStyle} />
          <input placeholder="Client Token (opcional)" value={form.zapi_client_token} onChange={(e) => setForm({ ...form, zapi_client_token: e.target.value })} style={inputStyle} />
          <button type="submit" style={{ padding: "0.5rem 1rem", background: "#075e54", color: "#fff", border: "none", borderRadius: 4, cursor: "pointer" }}>
            Criar
          </button>
        </form>
      )}

      {msg && <p style={{ padding: "0.5rem", background: "#f5f5f5", borderRadius: 4 }}>{msg}</p>}

      {qrData && (
        <div style={{ textAlign: "center", padding: "1rem", border: "1px solid #ddd", borderRadius: 4, marginBottom: "1rem" }}>
          <img src={qrData.qr} alt="QR Code" style={{ maxWidth: 256 }} />
          <p style={{ fontSize: "0.85rem", color: "#666" }}>Escaneie com o WhatsApp</p>
        </div>
      )}

      {instances.length === 0 && !showForm && (
        <p style={{ color: "#999", textAlign: "center", padding: "2rem" }}>Nenhuma instância. Clique em &quot;+ Nova&quot; para começar.</p>
      )}

      {instances.map((inst) => (
        <div key={inst.id} style={{
          border: "1px solid #ddd", borderRadius: 4, padding: "0.75rem 1rem",
          marginBottom: "0.5rem", display: "flex", justifyContent: "space-between", alignItems: "center",
        }}>
          <div>
            <strong>{inst.name}</strong>
            <div style={{ fontSize: "0.8rem", color: "#666" }}>
              {inst.connected_phone || inst.zapi_instance_id}
            </div>
          </div>
          <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
            <span style={{
              fontSize: "0.75rem", padding: "0.2rem 0.5rem", borderRadius: 12,
              background: inst.status === "connected" ? "#dcf8c6" : "#fdd",
              color: inst.status === "connected" ? "#075e54" : "#c00",
            }}>
              {inst.status}
            </span>
            {inst.status !== "connected" && (
              <button onClick={() => connectInstance(inst.id)} style={{
                padding: "0.3rem 0.75rem", background: "#25d366", color: "#fff",
                border: "none", borderRadius: 4, cursor: "pointer", fontSize: "0.85rem",
              }}>
                Conectar
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
