"use client";

import { useMemo, useState } from "react";
import { TaskStatusBadge } from "./TaskStatusBadge";
import { linkify } from "../lib/linkify";
import type { Task, TaskParticipant } from "../hooks/useTasks";
import { useTaskThread } from "../hooks/useTaskThread";

interface Props {
  task: Task | null;
  loading: boolean;
  onClose: () => void;
  onUpdateStatus: (status: string) => void;
  onRemoveParticipant: (id: string) => void;
  onSendDirectMessage: (contactJid: string, body: string) => Promise<boolean>;
  onDelete: () => void;
}

function formatTs(iso: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleString("pt-BR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

const STATUS_FLOW = ["open", "in_progress", "resolved", "closed"];
const STATUS_LABEL: Record<string, string> = {
  open: "Aberta",
  in_progress: "Em progresso",
  resolved: "Resolvida",
  closed: "Fechada",
};

export function TaskDetailModal({
  task, loading, onClose,
  onUpdateStatus, onRemoveParticipant, onSendDirectMessage, onDelete,
}: Props) {
  const [composer, setComposer] = useState("");
  const [visibility, setVisibility] = useState<"all" | "internal">("all");
  const [sending, setSending] = useState(false);
  const [dmTarget, setDmTarget] = useState<TaskParticipant | null>(null);
  const [dmBody, setDmBody] = useState("");

  const participants = useMemo(() => (task?.task_participants ?? []) as TaskParticipant[], [task]);
  const externos = useMemo(() => participants.filter((p) => !!p.contact_jid), [participants]);

  const { items, groupJid, post: postThread } = useTaskThread(
    task?.id ?? null,
    task?.status,
  );

  // Set of JIDs that have posted in the thread — drives the "não respondeu"
  // badge. If a participant's JID never appears as from_jid, they haven't
  // engaged yet. from_jid isn't in the ThreadItem type so we infer from
  // senderName ≠ "Você" AND fromMe=false against… simpler: anyone with at
  // least one thread item mapped by sender name.
  const respondedNames = useMemo(() => {
    const s = new Set<string>();
    for (const it of items) {
      if (!it.fromMe && it.senderName) s.add(it.senderName.toLowerCase());
    }
    return s;
  }, [items]);

  if (!task) return null;

  async function handleSend() {
    if (!composer.trim() || sending) return;
    setSending(true);
    await postThread(composer.trim(), visibility);
    setComposer("");
    setSending(false);
  }

  async function handleDmSend() {
    if (!dmTarget?.contact_jid || !dmBody.trim()) return;
    setSending(true);
    const ok = await onSendDirectMessage(dmTarget.contact_jid, dmBody.trim());
    setSending(false);
    if (ok) {
      setDmBody("");
      setDmTarget(null);
    } else {
      alert("Falha ao enviar");
    }
  }

  const nextStatus = STATUS_FLOW[STATUS_FLOW.indexOf(task.status) + 1];

  function hasResponded(p: TaskParticipant): boolean {
    if (!p.contact_jid) return true; // internos sempre considerados "ok"
    // Match by contact_jid prefix vs. from_jid isn't available on ThreadItem;
    // approximate with name comparison when possible. Conservative: we
    // consider them "não respondeu" if their join succeeded but no thread
    // item shares their contact_jid prefix.
    const prefix = p.contact_jid.split("@")[0];
    return respondedNames.has(prefix.toLowerCase()) ||
      Array.from(respondedNames).some((n) => n.includes(prefix));
  }

  return (
    <div className="wa-modal-overlay" onClick={onClose}>
      <div
        className="wa-modal wa-modal-lg"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: 820, height: "85vh", display: "flex", flexDirection: "column" }}
      >
        {/* Header */}
        <div className="wa-modal-header">
          <div style={{ flex: 1, overflow: "hidden" }}>
            <div className="wa-modal-title" style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <TaskStatusBadge value={task.priority} type="priority" />
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {task.title}
              </span>
            </div>
            <div style={{ color: "#8696a0", fontSize: 11, marginTop: 2 }}>
              {STATUS_LABEL[task.status]}
              {task.due_date ? ` · prazo ${new Date(task.due_date).toLocaleDateString("pt-BR")}` : ""}
              {groupJid ? ` · grupo WhatsApp ativo` : ""}
            </div>
          </div>
          <button className="wa-modal-close" onClick={onClose}>×</button>
        </div>

        {loading && <div style={{ color: "#8696a0", textAlign: "center", padding: 20 }}>Carregando...</div>}

        <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
          {/* Participants column */}
          <div style={{ width: 260, borderRight: "1px solid rgba(255,255,255,0.06)", display: "flex", flexDirection: "column" }}>
            <div style={{ padding: "12px 16px", color: "#8696a0", fontSize: 11, fontWeight: 500, textTransform: "uppercase", letterSpacing: 0.5 }}>
              Participantes ({participants.length})
            </div>
            <div style={{ flex: 1, overflowY: "auto", padding: "0 8px" }}>
              {participants.map((p) => {
                const label = p.contact_jid?.split("@")[0] ?? p.user_id?.slice(0, 8) ?? "—";
                const isExternal = !!p.contact_jid;
                const responded = hasResponded(p);
                return (
                  <div
                    key={p.id}
                    style={{
                      padding: "8px 10px",
                      borderRadius: 8,
                      marginBottom: 4,
                      background: "rgba(255,255,255,0.03)",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6 }}>
                      <span style={{ color: "#e9edef", fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {label}
                      </span>
                      {p.role !== "owner" && (
                        <button
                          onClick={() => onRemoveParticipant(p.id)}
                          style={{ background: "transparent", border: "none", color: "#ef4444", fontSize: 11, cursor: "pointer" }}
                          title="Remover participante"
                        >
                          ✕
                        </button>
                      )}
                    </div>
                    <div style={{ fontSize: 10, color: "#8696a0", marginTop: 2, display: "flex", gap: 6, flexWrap: "wrap" }}>
                      <span>{p.role}</span>
                      {isExternal && p.join_failure && (
                        <span style={{ color: "#ef4444" }} title={p.join_failure}>⚠ falha ao adicionar</span>
                      )}
                      {isExternal && !p.join_failure && !responded && (
                        <span style={{ color: "#f59e0b", fontWeight: 500 }}>⏳ não respondeu</span>
                      )}
                      {isExternal && responded && (
                        <span style={{ color: "#00a884", fontWeight: 500 }}>✓ respondeu</span>
                      )}
                    </div>
                    {isExternal && (
                      <button
                        onClick={() => { setDmTarget(p); setDmBody(""); }}
                        style={{
                          marginTop: 6,
                          background: "transparent",
                          border: "1px solid rgba(0,168,132,0.4)",
                          color: "#00a884",
                          fontSize: 10,
                          padding: "2px 8px",
                          borderRadius: 999,
                          cursor: "pointer",
                          width: "100%",
                        }}
                      >
                        ✉ DM privada
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
            {/* Status / action footer */}
            <div style={{ padding: "12px 16px", borderTop: "1px solid rgba(255,255,255,0.06)" }}>
              {nextStatus && (
                <button
                  onClick={() => onUpdateStatus(nextStatus)}
                  style={{
                    width: "100%",
                    background: "#00a884",
                    color: "#111b21",
                    border: "none",
                    padding: "8px 12px",
                    borderRadius: 8,
                    fontSize: 13,
                    fontWeight: 500,
                    cursor: "pointer",
                  }}
                >
                  → {STATUS_LABEL[nextStatus]}
                </button>
              )}
              <button
                onClick={() => { if (confirm("Apagar esta tarefa?")) onDelete(); }}
                style={{
                  width: "100%",
                  background: "transparent",
                  color: "#ef4444",
                  border: "1px solid rgba(239,68,68,0.25)",
                  padding: "6px 12px",
                  borderRadius: 8,
                  fontSize: 12,
                  marginTop: 8,
                  cursor: "pointer",
                }}
              >
                Apagar tarefa
              </button>
            </div>
          </div>

          {/* Thread */}
          <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
            <div style={{ flex: 1, overflowY: "auto", padding: "12px 16px" }}>
              {items.length === 0 && (
                <div style={{ color: "#8696a0", textAlign: "center", padding: 20, fontSize: 13 }}>
                  {groupJid
                    ? "Nenhuma mensagem no fórum ainda."
                    : "Esta tarefa não tem grupo. Edite-a para adicionar participantes."}
                </div>
              )}
              {items.map((it) => {
                const when = new Date(it.timestamp).toLocaleString("pt-BR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
                const isInternal = it.source === "internal_comment";
                return (
                  <div
                    key={it.id}
                    style={{
                      background: isInternal ? "rgba(245,158,11,0.08)" : "rgba(83,189,235,0.06)",
                      borderLeft: `2px solid ${isInternal ? "rgba(245,158,11,0.55)" : "rgba(83,189,235,0.5)"}`,
                      borderRadius: "0 8px 8px 0",
                      padding: "6px 10px",
                      marginBottom: 6,
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 2, gap: 8 }}>
                      <span style={{ color: isInternal ? "#f59e0b" : "#53bdeb", fontSize: 11, fontWeight: 500 }}>
                        {isInternal ? "💬 " : ""}
                        {it.fromMe ? "Você" : (it.senderName ?? "—")}
                        {isInternal && <span style={{ color: "#8696a0", marginLeft: 6, fontWeight: 400 }}>(interno)</span>}
                      </span>
                      <span style={{ color: "#8696a0", fontSize: 10 }}>{when}</span>
                    </div>
                    <div style={{ color: "#e9edef", fontSize: 13, whiteSpace: "pre-wrap" }}>
                      {linkify(it.body ?? "")}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Composer */}
            {groupJid && (
              <div style={{ padding: "8px 12px", borderTop: "1px solid rgba(255,255,255,0.06)" }}>
                <div style={{ display: "flex", gap: 8, marginBottom: 6 }}>
                  <button
                    onClick={() => setVisibility("all")}
                    style={{
                      background: visibility === "all" ? "rgba(83,189,235,0.18)" : "transparent",
                      border: `1px solid ${visibility === "all" ? "#53bdeb" : "rgba(255,255,255,0.08)"}`,
                      color: visibility === "all" ? "#53bdeb" : "#8696a0",
                      padding: "4px 10px",
                      borderRadius: 999,
                      fontSize: 11,
                      cursor: "pointer",
                    }}
                  >
                    📢 Grupo (todos veem)
                  </button>
                  <button
                    onClick={() => setVisibility("internal")}
                    style={{
                      background: visibility === "internal" ? "rgba(245,158,11,0.18)" : "transparent",
                      border: `1px solid ${visibility === "internal" ? "#f59e0b" : "rgba(255,255,255,0.08)"}`,
                      color: visibility === "internal" ? "#f59e0b" : "#8696a0",
                      padding: "4px 10px",
                      borderRadius: 999,
                      fontSize: 11,
                      cursor: "pointer",
                    }}
                  >
                    💬 Interno (só time)
                  </button>
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <input
                    style={{
                      flex: 1,
                      background: "#2a3942",
                      border: "none",
                      borderRadius: 8,
                      padding: "8px 12px",
                      color: "#e9edef",
                      fontSize: 13,
                      outline: "none",
                    }}
                    value={composer}
                    onChange={(e) => setComposer(e.target.value)}
                    placeholder={
                      visibility === "all"
                        ? "Mensagem para o grupo..."
                        : "Anotação interna (invisível aos externos)..."
                    }
                    onKeyDown={(e) => e.key === "Enter" && handleSend()}
                  />
                  <button
                    onClick={handleSend}
                    disabled={!composer.trim() || sending}
                    style={{
                      background: "#00a884",
                      border: "none",
                      color: "#111b21",
                      padding: "8px 14px",
                      borderRadius: 8,
                      fontSize: 13,
                      fontWeight: 500,
                      cursor: "pointer",
                      opacity: !composer.trim() || sending ? 0.5 : 1,
                    }}
                  >
                    Enviar
                  </button>
                </div>
                {externos.length === 0 && (
                  <div style={{ color: "#8696a0", fontSize: 11, marginTop: 6 }}>
                    Adicione um participante externo para ativar o fórum.
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* DM private sub-modal */}
        {dmTarget && (
          <div
            className="wa-modal-overlay"
            onClick={() => setDmTarget(null)}
            style={{ zIndex: 100 }}
          >
            <div
              className="wa-modal"
              onClick={(e) => e.stopPropagation()}
              style={{ maxWidth: 440 }}
            >
              <div className="wa-modal-header">
                <span className="wa-modal-title">
                  DM privada para {dmTarget.contact_jid?.split("@")[0]}
                </span>
                <button className="wa-modal-close" onClick={() => setDmTarget(null)}>×</button>
              </div>
              <div className="wa-modal-body">
                <div style={{ fontSize: 12, color: "#8696a0", marginBottom: 8 }}>
                  Só esse contato recebe. O grupo da tarefa não é notificado.
                </div>
                <textarea
                  className="wa-modal-textarea"
                  value={dmBody}
                  onChange={(e) => setDmBody(e.target.value)}
                  placeholder="Mensagem privada..."
                  rows={4}
                  autoFocus
                />
              </div>
              <div className="wa-modal-footer">
                <button className="wa-modal-secondary" onClick={() => setDmTarget(null)}>
                  Cancelar
                </button>
                <button
                  className="wa-modal-primary"
                  onClick={handleDmSend}
                  disabled={!dmBody.trim() || sending}
                >
                  {sending ? "Enviando..." : "Enviar DM"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
