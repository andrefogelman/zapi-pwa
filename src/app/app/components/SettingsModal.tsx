"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/lib/use-auth";
import type { Instance } from "../hooks/useInstances";

interface Props {
  open: boolean;
  onClose: () => void;
  instances: Instance[];
  onCreate: (name: string) => Promise<Instance | null>;
  onDelete: (id: string) => Promise<boolean>;
  onRename: (id: string, name: string) => Promise<boolean>;
  onReload: () => Promise<void>;
}

type View = "list" | "new" | "qr";

export function SettingsModal({
  open, onClose, instances, onCreate, onDelete, onRename, onReload,
}: Props) {
  const { session } = useAuth();
  const [view, setView] = useState<View>("list");
  const [newName, setNewName] = useState("");
  const [pendingInstance, setPendingInstance] = useState<Instance | null>(null);
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [authState, setAuthState] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const authHeaders = useCallback((): Record<string, string> => {
    const token = session?.access_token;
    const h: Record<string, string> = {};
    if (token) h.Authorization = `Bearer ${token}`;
    return h;
  }, [session?.access_token]);

  useEffect(() => {
    if (!open) {
      setView("list");
      setNewName("");
      setPendingInstance(null);
      setQrCode(null);
      setAuthState(null);
      setError(null);
      setBusy(false);
    }
  }, [open]);

  // Poll QR + status while showing the QR view
  useEffect(() => {
    if (view !== "qr" || !pendingInstance || !session?.access_token) return;
    let cancelled = false;
    const sessionId = pendingInstance.waclaw_session_id;
    if (!sessionId) return;

    async function poll() {
      try {
        const res = await fetch(`/api/waclaw/sessions/${sessionId}/qr`, {
          headers: authHeaders(),
        });
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;
        if (data.qr) setQrCode(data.qr);
        if (data.state) setAuthState(data.state);
        if (data.state === "connected" || data.hasDatabase) {
          cancelled = true;
          await onReload();
          setTimeout(() => {
            if (!cancelled) {
              setView("list");
              setPendingInstance(null);
              setQrCode(null);
              setAuthState(null);
            }
          }, 800);
        }
      } catch {}
    }

    poll();
    const interval = setInterval(poll, 2000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [view, pendingInstance, session?.access_token, authHeaders, onReload]);

  async function handleCreate() {
    if (!newName.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const inst = await onCreate(newName.trim());
      if (!inst || !inst.waclaw_session_id) {
        throw new Error("Falha ao criar sessão");
      }

      // Kick off auth on waclaw
      const res = await fetch(`/api/waclaw/sessions/${inst.waclaw_session_id}/auth`, {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
      });
      if (!res.ok) throw new Error(`Auth falhou (HTTP ${res.status})`);
      const authData = await res.json();
      if (authData.qr) setQrCode(authData.qr);
      if (authData.status) setAuthState(authData.status);
      setPendingInstance(inst);
      setView("qr");
      setNewName("");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(id: string, name: string) {
    if (!confirm(`Remover a instância "${name}"? Esta ação não pode ser desfeita.`)) return;
    await onDelete(id);
  }

  async function handleReconnect(inst: Instance) {
    if (!inst.waclaw_session_id) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/waclaw/sessions/${inst.waclaw_session_id}/auth`, {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
      });
      if (!res.ok) throw new Error(`Auth falhou (HTTP ${res.status})`);
      const data = await res.json();
      if (data.qr) setQrCode(data.qr);
      if (data.status) setAuthState(data.status);
      setPendingInstance(inst);
      setView("qr");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!open) return null;

  return (
    <div className="wa-modal-overlay" onClick={onClose}>
      <div className="wa-modal wa-modal-lg" onClick={(e) => e.stopPropagation()}>
        <div className="wa-modal-header">
          <div className="wa-modal-title">
            {view === "list" && "Instâncias"}
            {view === "new" && "Nova instância"}
            {view === "qr" && "Escaneie o código"}
          </div>
          <button className="wa-modal-close" onClick={onClose}>✕</button>
        </div>

        <div className="wa-modal-body">
          {view === "list" && (
            <>
              {instances.length === 0 && (
                <div className="wa-contact-empty">
                  Nenhuma instância ainda. Adicione uma para começar.
                </div>
              )}
              {instances.map((inst) => (
                <div key={inst.id} className="wa-settings-item">
                  <div className="wa-settings-info">
                    <div className="wa-settings-name">
                      <RenameField
                        value={inst.name}
                        onSave={(v) => onRename(inst.id, v)}
                      />
                    </div>
                    <div className="wa-settings-sub">
                      {inst.provider === "waclaw" ? "WaClaw" : "Z-API"}
                      {inst.connected_phone ? ` · ${inst.connected_phone}` : ""}
                      {inst.waclaw_session_id ? ` · ${inst.waclaw_session_id.slice(0, 8)}` : ""}
                    </div>
                  </div>
                  <div className="wa-settings-actions">
                    {inst.provider === "waclaw" && (
                      <button
                        className="wa-settings-btn"
                        onClick={() => handleReconnect(inst)}
                        disabled={busy}
                      >
                        Reconectar
                      </button>
                    )}
                    <button
                      className="wa-settings-btn wa-settings-danger"
                      onClick={() => handleDelete(inst.id, inst.name)}
                    >
                      Remover
                    </button>
                  </div>
                </div>
              ))}
              {instances.length < 3 && (
                <button
                  className="wa-modal-primary wa-settings-add"
                  onClick={() => setView("new")}
                >
                  + Adicionar instância
                </button>
              )}
            </>
          )}

          {view === "new" && (
            <>
              <label className="wa-modal-label">Nome (ex: Pessoal, Trabalho, Vendas)</label>
              <input
                className="wa-modal-input"
                placeholder="Nome da instância"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                autoFocus
                onKeyDown={(e) => e.key === "Enter" && handleCreate()}
              />
              {error && <div className="wa-modal-error">{error}</div>}
            </>
          )}

          {view === "qr" && (
            <div className="wa-qr-wrap">
              {qrCode ? (
                <>
                  <img
                    src={`https://api.qrserver.com/v1/create-qr-code/?size=260x260&margin=0&data=${encodeURIComponent(qrCode)}`}
                    alt="QR Code"
                    className="wa-qr-img"
                  />
                  <div className="wa-qr-instructions">
                    <p><strong>1.</strong> Abra o WhatsApp no celular</p>
                    <p><strong>2.</strong> Toque em <em>Configurações → Aparelhos conectados → Conectar aparelho</em></p>
                    <p><strong>3.</strong> Aponte a câmera para este QR</p>
                  </div>
                  <div className="wa-qr-state">
                    {authState === "waiting_qr" && "Aguardando scan..."}
                    {authState === "connected" && "Conectado! ✓"}
                  </div>
                </>
              ) : (
                <div className="wa-contact-empty">Gerando QR code...</div>
              )}
              {error && <div className="wa-modal-error">{error}</div>}
            </div>
          )}
        </div>

        {view === "new" && (
          <div className="wa-modal-footer">
            <button
              className="wa-modal-secondary"
              onClick={() => setView("list")}
              disabled={busy}
            >
              Cancelar
            </button>
            <button
              className="wa-modal-primary"
              onClick={handleCreate}
              disabled={!newName.trim() || busy}
            >
              {busy ? "Criando..." : "Criar e conectar"}
            </button>
          </div>
        )}

        {view === "qr" && (
          <div className="wa-modal-footer">
            <button
              className="wa-modal-secondary"
              onClick={() => setView("list")}
            >
              Voltar
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function RenameField({ value, onSave }: { value: string; onSave: (v: string) => Promise<boolean> }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  useEffect(() => { setDraft(value); }, [value]);

  if (!editing) {
    return (
      <span className="wa-rename-display" onClick={() => setEditing(true)} title="Clique para renomear">
        {value}
      </span>
    );
  }
  return (
    <input
      className="wa-rename-input"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={async () => {
        if (draft.trim() && draft !== value) await onSave(draft.trim());
        setEditing(false);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") { setDraft(value); setEditing(false); }
      }}
      autoFocus
    />
  );
}
