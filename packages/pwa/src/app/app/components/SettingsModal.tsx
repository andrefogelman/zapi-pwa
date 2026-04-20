"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/lib/use-auth";
import type { Instance } from "../hooks/useInstances";
import { useUserSettings } from "../hooks/useUserSettings";

interface Props {
  open: boolean;
  onClose: () => void;
  instances: Instance[];
  activeInstanceId: string | null;
  onCreate: (name: string) => Promise<Instance | null>;
  onDelete: (id: string) => Promise<boolean>;
  onRename: (id: string, name: string) => Promise<boolean>;
  onReorder?: (order: string[]) => Promise<void>;
  onReload: () => Promise<void>;
}

type View = "list" | "new" | "qr";
type Tab = "instancias" | "perfil" | "grupos";

interface GroupRow {
  group_id: string;
  subject: string;
  transcribe_all: boolean;
  send_reply: boolean;
  monitor_daily: boolean;
}

interface FetchedGroup {
  group_id: string;
  subject: string;
}

export function SettingsModal({
  open, onClose, instances, activeInstanceId, onCreate, onDelete, onRename, onReorder, onReload,
}: Props) {
  const { session } = useAuth();
  const [tab, setTab] = useState<Tab>("instancias");
  const [view, setView] = useState<View>("list");
  const [newName, setNewName] = useState("");
  const [pendingInstance, setPendingInstance] = useState<Instance | null>(null);
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [authState, setAuthState] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Perfil tab state
  const { settings, update: updateSettings } = useUserSettings();
  const [localName, setLocalName] = useState("");
  const [localFooter, setLocalFooter] = useState("");
  const [savingPerfil, setSavingPerfil] = useState(false);
  const [perfilMsg, setPerfilMsg] = useState("");

  // Grupos tab state
  const [groups, setGroups] = useState<GroupRow[]>([]);
  const [fetchedGroups, setFetchedGroups] = useState<FetchedGroup[]>([]);
  const [fetchingGroups, setFetchingGroups] = useState(false);

  // Avatar refresh state
  const [refreshingAvatars, setRefreshingAvatars] = useState<string | null>(null); // sessionId being refreshed
  const [avatarRefreshMsg, setAvatarRefreshMsg] = useState<string | null>(null);

  const authHeaders = useCallback((): Record<string, string> => {
    const token = session?.access_token;
    const h: Record<string, string> = {};
    if (token) h.Authorization = `Bearer ${token}`;
    return h;
  }, [session?.access_token]);

  useEffect(() => {
    if (!open) {
      setTab("instancias");
      setView("list");
      setNewName("");
      setPendingInstance(null);
      setQrCode(null);
      setAuthState(null);
      setError(null);
      setBusy(false);
    }
  }, [open]);

  // Sync perfil fields from settings
  useEffect(() => {
    if (settings) {
      setLocalName(settings.display_name ?? "");
      setLocalFooter(settings.transcription_footer ?? "");
    }
  }, [settings]);

  const loadGroups = useCallback(async () => {
    if (!activeInstanceId || !session?.access_token) return;
    try {
      const res = await fetch(`/api/instances/${activeInstanceId}/groups`, {
        headers: authHeaders(),
      });
      if (!res.ok) return;
      const data = await res.json();
      setGroups(data.groups ?? []);
    } catch {}
  }, [activeInstanceId, session?.access_token, authHeaders]);

  // Load groups when opening the Grupos tab or switching instance
  useEffect(() => {
    if (open && tab === "grupos") {
      setFetchedGroups([]);
      loadGroups();
    }
  }, [open, tab, activeInstanceId, loadGroups]);

  async function savePerfil() {
    setSavingPerfil(true);
    try {
      await updateSettings({
        display_name: localName,
        transcription_footer: localFooter,
      });
      setPerfilMsg("Salvo!");
    } catch (err) {
      setPerfilMsg(`Erro: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSavingPerfil(false);
      setTimeout(() => setPerfilMsg(""), 3000);
    }
  }

  async function fetchFromWhatsApp() {
    if (!activeInstanceId || !session?.access_token) return;
    setFetchingGroups(true);
    try {
      const res = await fetch(`/api/instances/${activeInstanceId}/groups/fetch`, {
        headers: authHeaders(),
      });
      if (!res.ok) return;
      const data = await res.json();
      setFetchedGroups(data.groups ?? []);
    } finally {
      setFetchingGroups(false);
    }
  }

  async function importGroup(g: FetchedGroup) {
    if (!activeInstanceId || !session?.access_token) return;
    await fetch(`/api/instances/${activeInstanceId}/groups`, {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ group_id: g.group_id, subject: g.subject }),
    });
    loadGroups();
  }

  async function toggleGroupFlag(
    groupId: string,
    field: "transcribe_all" | "send_reply" | "monitor_daily",
    value: boolean,
  ) {
    if (!activeInstanceId || !session?.access_token) return;
    await fetch(
      `/api/instances/${activeInstanceId}/groups/${encodeURIComponent(groupId)}`,
      {
        method: "PATCH",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ [field]: value }),
      },
    );
    setGroups((prev) =>
      prev.map((g) => (g.group_id === groupId ? { ...g, [field]: value } : g)),
    );
  }

  async function removeGroup(groupId: string) {
    if (!activeInstanceId || !session?.access_token) return;
    if (!confirm("Remover este grupo?")) return;
    await fetch(
      `/api/instances/${activeInstanceId}/groups/${encodeURIComponent(groupId)}`,
      {
        method: "DELETE",
        headers: authHeaders(),
      },
    );
    loadGroups();
  }

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

  async function handleAvatarRefresh(sessionId: string) {
    if (refreshingAvatars) return;
    setRefreshingAvatars(sessionId);
    setAvatarRefreshMsg(null);
    try {
      const res = await fetch(`/api/waclaw/sessions/${sessionId}/avatars/refresh`, {
        method: "POST",
        headers: authHeaders(),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const downloaded = data.downloaded ?? 0;
      setAvatarRefreshMsg(`${downloaded} foto(s) atualizada(s). Recarregue a página para ver.`);
    } catch (err) {
      setAvatarRefreshMsg(`Erro: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setRefreshingAvatars(null);
      setTimeout(() => setAvatarRefreshMsg(null), 8000);
    }
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

  const tabBtnStyle = (active: boolean): React.CSSProperties => ({
    padding: "0.5rem 1rem",
    background: active ? "#e0f2f1" : "transparent",
    border: "none",
    borderBottom: active ? "2px solid #00796b" : "2px solid transparent",
    cursor: "pointer",
    fontWeight: active ? 600 : 400,
  });

  return (
    <div className="wa-modal-overlay" onClick={onClose}>
      <div className="wa-modal wa-modal-lg" onClick={(e) => e.stopPropagation()}>
        <div className="wa-modal-header">
          <div className="wa-modal-title">
            {tab === "instancias" && view === "list" && "Instâncias"}
            {tab === "instancias" && view === "new" && "Nova instância"}
            {tab === "instancias" && view === "qr" && "Escaneie o código"}
            {tab === "perfil" && "Perfil"}
            {tab === "grupos" && "Grupos"}
          </div>
          <button className="wa-modal-close" onClick={onClose}>✕</button>
        </div>

        <div
          style={{
            display: "flex",
            borderBottom: "1px solid #e0e0e0",
            padding: "0 1rem",
          }}
        >
          <button
            onClick={() => setTab("instancias")}
            style={tabBtnStyle(tab === "instancias")}
          >
            Instâncias
          </button>
          <button
            onClick={() => setTab("perfil")}
            style={tabBtnStyle(tab === "perfil")}
          >
            Perfil
          </button>
          <button
            onClick={() => setTab("grupos")}
            style={tabBtnStyle(tab === "grupos")}
          >
            Grupos
          </button>
        </div>

        <div className="wa-modal-body">
          {tab === "instancias" && view === "list" && (
            <>
              {instances.length === 0 && (
                <div className="wa-contact-empty">
                  Nenhuma instância ainda. Adicione uma para começar.
                </div>
              )}
              {instances.map((inst, idx) => (
                <div key={inst.id} className="wa-settings-item">
                  <div style={{ display: "flex", flexDirection: "column", gap: 2, marginRight: 8 }}>
                    <button
                      className="wa-settings-btn"
                      style={{ padding: "2px 6px", fontSize: 12, opacity: idx === 0 ? 0.3 : 1 }}
                      disabled={idx === 0}
                      onClick={() => {
                        const ids = instances.map((i) => i.id);
                        [ids[idx - 1], ids[idx]] = [ids[idx], ids[idx - 1]];
                        onReorder?.(ids);
                      }}
                      title="Mover para cima"
                    >
                      ↑
                    </button>
                    <button
                      className="wa-settings-btn"
                      style={{ padding: "2px 6px", fontSize: 12, opacity: idx === instances.length - 1 ? 0.3 : 1 }}
                      disabled={idx === instances.length - 1}
                      onClick={() => {
                        const ids = instances.map((i) => i.id);
                        [ids[idx], ids[idx + 1]] = [ids[idx + 1], ids[idx]];
                        onReorder?.(ids);
                      }}
                      title="Mover para baixo"
                    >
                      ↓
                    </button>
                  </div>
                  <div className="wa-settings-info">
                    <div className="wa-settings-name">
                      {idx === 0 && (
                        <span style={{ fontSize: 10, color: "#00a884", fontWeight: 600, marginRight: 6, verticalAlign: "middle" }}>
                          PADRÃO
                        </span>
                      )}
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
                    {inst.provider === "waclaw" && inst.waclaw_session_id && (
                      <button
                        className="wa-settings-btn"
                        onClick={() => handleAvatarRefresh(inst.waclaw_session_id!)}
                        disabled={refreshingAvatars === inst.waclaw_session_id}
                        title="Baixar fotos de perfil do WhatsApp"
                      >
                        {refreshingAvatars === inst.waclaw_session_id ? "Baixando..." : "📷 Fotos"}
                      </button>
                    )}
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
              {avatarRefreshMsg && (
                <div
                  style={{
                    margin: "10px 0 4px",
                    padding: "8px 12px",
                    background: "rgba(0, 168, 132, 0.1)",
                    border: "1px solid rgba(0, 168, 132, 0.3)",
                    borderRadius: 6,
                    color: "#00a884",
                    fontSize: 13,
                  }}
                >
                  {avatarRefreshMsg}
                </div>
              )}
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

          {tab === "instancias" && view === "new" && (
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

          {tab === "instancias" && view === "qr" && (
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

          {tab === "perfil" && (
            <div>
              <label
                style={{
                  display: "block",
                  marginBottom: "0.25rem",
                  fontWeight: 500,
                }}
              >
                Nome de exibição
              </label>
              <input
                value={localName}
                onChange={(e) => setLocalName(e.target.value)}
                style={{
                  width: "100%",
                  padding: "0.5rem",
                  marginBottom: "1rem",
                  border: "1px solid #ccc",
                  borderRadius: 4,
                }}
              />

              <label
                style={{
                  display: "block",
                  marginBottom: "0.25rem",
                  fontWeight: 500,
                }}
              >
                Rodapé da transcrição
              </label>
              <input
                value={localFooter}
                onChange={(e) => setLocalFooter(e.target.value)}
                placeholder="Transcrição por IA by Andre 😜"
                style={{
                  width: "100%",
                  padding: "0.5rem",
                  marginBottom: "1rem",
                  border: "1px solid #ccc",
                  borderRadius: 4,
                }}
              />

              <div
                style={{
                  padding: "1rem",
                  background: "#f5f5f5",
                  borderRadius: 4,
                  marginBottom: "1rem",
                  fontSize: "0.9rem",
                }}
              >
                <strong>Preview:</strong>
                <div style={{ marginTop: "0.5rem", whiteSpace: "pre-wrap" }}>
                  {`Olá, tudo bem? Esse é um exemplo de transcrição.\n\n${localFooter}`}
                </div>
              </div>

              <button
                onClick={savePerfil}
                disabled={savingPerfil}
                className="wa-modal-primary"
                style={{ padding: "0.5rem 1rem" }}
              >
                {savingPerfil ? "Salvando..." : "Salvar perfil"}
              </button>
              {perfilMsg && (
                <p
                  style={{
                    color: perfilMsg.startsWith("Erro") ? "red" : "green",
                    marginTop: "0.5rem",
                  }}
                >
                  {perfilMsg}
                </p>
              )}
            </div>
          )}

          {tab === "grupos" && (
            <div>
              {!activeInstanceId ? (
                <p>Selecione uma instância primeiro.</p>
              ) : (
                <>
                  <div
                    style={{
                      padding: "0.75rem 1rem",
                      background: "rgba(0, 168, 132, 0.12)",
                      border: "1px solid rgba(0, 168, 132, 0.3)",
                      borderRadius: 6,
                      marginBottom: "1rem",
                      fontSize: "0.875rem",
                      lineHeight: 1.45,
                    }}
                  >
                    Por padrão apenas seus próprios áudios são transcritos.
                    Autorize os grupos onde você quer <strong>transcrever
                    também os áudios enviados por terceiros</strong>.
                  </div>

                  {(groups.length > 0 || fetchedGroups.length > 0) && (
                    <button
                      onClick={fetchFromWhatsApp}
                      disabled={fetchingGroups}
                      className="wa-modal-primary"
                      style={{ padding: "0.5rem 1rem", marginBottom: "1rem" }}
                    >
                      {fetchingGroups
                        ? "Buscando..."
                        : "Buscar mais grupos do WhatsApp"}
                    </button>
                  )}

                  {fetchedGroups.length > 0 && (
                    <div
                      style={{
                        border: "1px solid #ddd",
                        padding: "0.5rem",
                        marginBottom: "1rem",
                        borderRadius: 4,
                      }}
                    >
                      <h4 style={{ margin: "0 0 0.5rem 0" }}>
                        Selecione os grupos para autorizar
                      </h4>
                      {fetchedGroups.map((g) => (
                        <div
                          key={g.group_id}
                          style={{
                            padding: "0.25rem",
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center",
                          }}
                        >
                          <span>{g.subject}</span>
                          <button
                            onClick={() => importGroup(g)}
                            style={{ fontSize: "0.8rem" }}
                          >
                            Autorizar
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  {groups.length === 0 && fetchedGroups.length === 0 ? (
                    <div
                      style={{
                        padding: "2rem 1rem",
                        textAlign: "center",
                        border: "1px dashed #444",
                        borderRadius: 6,
                      }}
                    >
                      <p style={{ margin: "0 0 0.5rem 0", fontWeight: 600 }}>
                        Nenhum grupo autorizado ainda.
                      </p>
                      <p
                        style={{
                          margin: "0 0 1.25rem 0",
                          color: "#888",
                          fontSize: "0.875rem",
                        }}
                      >
                        Busque os grupos do seu WhatsApp e escolha em quais
                        você quer ligar a transcrição de áudios de terceiros.
                      </p>
                      <button
                        onClick={fetchFromWhatsApp}
                        disabled={fetchingGroups}
                        className="wa-modal-primary"
                        style={{ padding: "0.6rem 1.25rem" }}
                      >
                        {fetchingGroups
                          ? "Buscando..."
                          : "Buscar meus grupos do WhatsApp"}
                      </button>
                    </div>
                  ) : groups.length > 0 ? (
                    <>
                      <h3 style={{ marginTop: 0 }}>Grupos autorizados</h3>
                      <table
                        style={{
                          width: "100%",
                          borderCollapse: "collapse",
                          fontSize: "0.9rem",
                        }}
                      >
                        <thead>
                          <tr style={{ borderBottom: "2px solid #333" }}>
                            <th
                              style={{ textAlign: "left", padding: "0.5rem" }}
                            >
                              Grupo
                            </th>
                            <th
                              style={{
                                textAlign: "center",
                                padding: "0.5rem",
                              }}
                            >
                              Transcrever terceiros
                            </th>
                            <th
                              style={{
                                textAlign: "center",
                                padding: "0.5rem",
                              }}
                            >
                              Responder no chat
                            </th>
                            <th></th>
                          </tr>
                        </thead>
                        <tbody>
                          {groups.map((g) => (
                            <tr
                              key={g.group_id}
                              style={{ borderBottom: "1px solid #eee" }}
                            >
                              <td style={{ padding: "0.5rem" }}>{g.subject}</td>
                              <td style={{ textAlign: "center" }}>
                                <input
                                  type="checkbox"
                                  checked={g.transcribe_all}
                                  onChange={(e) =>
                                    toggleGroupFlag(
                                      g.group_id,
                                      "transcribe_all",
                                      e.target.checked,
                                    )
                                  }
                                />
                              </td>
                              <td style={{ textAlign: "center" }}>
                                <input
                                  type="checkbox"
                                  checked={g.send_reply}
                                  onChange={(e) =>
                                    toggleGroupFlag(
                                      g.group_id,
                                      "send_reply",
                                      e.target.checked,
                                    )
                                  }
                                />
                              </td>
                              <td>
                                <button
                                  onClick={() => removeGroup(g.group_id)}
                                  style={{
                                    color: "red",
                                    background: "none",
                                    border: "none",
                                    cursor: "pointer",
                                  }}
                                >
                                  Remover
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </>
                  ) : null}
                </>
              )}
            </div>
          )}
        </div>

        {tab === "instancias" && view === "new" && (
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

        {tab === "instancias" && view === "qr" && (
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
