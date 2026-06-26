"use client";

import { useEffect, useMemo, useState } from "react";
import { TaskStatusBadge } from "./TaskStatusBadge";
import { linkify } from "../lib/linkify";
import type { Task, TaskParticipant } from "../hooks/useTasks";
import { useTaskThread } from "../hooks/useTaskThread";
import type { Chat } from "../hooks/useChats";
import { formatChatName } from "../lib/formatters";

interface PickerContact {
  jid: string;
  name: string;
}

interface Props {
  task: Task | null;
  loading: boolean;
  currentUserId?: string | null;
  chats?: Chat[];
  onClose: () => void;
  onUpdateStatus: (status: string) => void;
  onUpdate: (updates: Partial<Pick<Task, "title" | "description" | "priority" | "due_date">>) => Promise<void>;
  onAddParticipant: (input: { contact_jid: string; contact_name: string }) => Promise<void>;
  onRemoveParticipant: (id: string) => void;
  onSendDirectMessage: (contactJid: string, body: string) => Promise<boolean>;
  onSearchContacts?: (q: string) => Promise<PickerContact[]>;
  onDelete: () => void;
}

const STATUS_FLOW = ["open", "in_progress", "resolved", "closed"];
const STATUS_LABEL: Record<string, string> = {
  open: "Aberta",
  in_progress: "Em progresso",
  resolved: "Resolvida",
  closed: "Fechada",
};

const PRIORITY_LABEL: Record<string, string> = {
  low: "Baixa",
  medium: "Média",
  high: "Alta",
  urgent: "Urgente",
};

export function TaskDetailModal({
  task, loading, currentUserId, chats = [], onClose,
  onUpdateStatus, onUpdate, onAddParticipant, onRemoveParticipant, onSendDirectMessage, onSearchContacts, onDelete,
}: Props) {
  const [composer, setComposer] = useState("");
  const [visibility, setVisibility] = useState<"all" | "internal">("all");
  const [sending, setSending] = useState(false);
  const [dmTarget, setDmTarget] = useState<TaskParticipant | null>(null);
  const [dmBody, setDmBody] = useState("");

  // Edit state
  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editPriority, setEditPriority] = useState("medium");
  const [editDueDate, setEditDueDate] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);
  const [pickerSearch, setPickerSearch] = useState("");
  const [pickerFocused, setPickerFocused] = useState(false);
  const [pickerExtraContacts, setPickerExtraContacts] = useState<PickerContact[]>([]);
  const [addingParticipant, setAddingParticipant] = useState(false);

  const participants = useMemo(() => (task?.task_participants ?? []) as TaskParticipant[], [task]);
  const externos = useMemo(() => participants.filter((p) => !!p.contact_jid), [participants]);

  const { items, groupJid, post: postThread } = useTaskThread(
    task?.id ?? null,
    task?.status,
  );

  const respondedNames = useMemo(() => {
    const s = new Set<string>();
    for (const it of items) {
      if (!it.fromMe && it.senderName) s.add(it.senderName.toLowerCase());
    }
    return s;
  }, [items]);

  const existingJids = useMemo(
    () => new Set(participants.map((p) => p.contact_jid).filter(Boolean) as string[]),
    [participants],
  );

  const filteredPicker = useMemo(() => {
    const q = pickerSearch.trim().toLowerCase();
    const dms = chats.filter((c) => !c.isGroup && !existingJids.has(c.jid));
    if (!q) return dms.slice(0, 30);
    return dms.filter((c) => c.name.toLowerCase().includes(q) || c.jid.includes(q)).slice(0, 30);
  }, [chats, existingJids, pickerSearch]);

  // Search address-book contacts when typing (complements active chats)
  useEffect(() => {
    if (!onSearchContacts || !pickerSearch.trim()) {
      setPickerExtraContacts([]);
      return;
    }
    let cancelled = false;
    const handle = setTimeout(async () => {
      const results = await onSearchContacts(pickerSearch.trim());
      if (!cancelled) {
        const chatJids = new Set(filteredPicker.map((c) => c.jid));
        setPickerExtraContacts(results.filter((c) => !existingJids.has(c.jid) && !chatJids.has(c.jid)));
      }
    }, 250);
    return () => { cancelled = true; clearTimeout(handle); };
  }, [pickerSearch, onSearchContacts, existingJids, filteredPicker]);

  if (!task) return null;

  async function handleAddParticipant(contact: { jid: string; name?: string | null }) {
    const name = formatChatName(contact.jid, contact.name ?? "");
    setAddingParticipant(true);
    await onAddParticipant({ contact_jid: contact.jid, contact_name: name });
    setAddingParticipant(false);
  }

  function participantLabel(p: TaskParticipant): string {
    if (p.contact_name) return p.contact_name;
    if (p.user_id) return p.user_id === currentUserId ? "Você" : p.user_id.slice(0, 8);
    return p.contact_jid?.split("@")[0] ?? "—";
  }

  function startEdit() {
    setEditTitle(task!.title);
    setEditDescription(task!.description ?? "");
    setEditPriority(task!.priority);
    setEditDueDate(task!.due_date ?? "");
    setEditing(true);
  }

  async function handleSave() {
    if (!editTitle.trim() || savingEdit) return;
    setSavingEdit(true);
    await onUpdate({
      title: editTitle.trim(),
      description: editDescription.trim() || null,
      priority: editPriority as Task["priority"],
      due_date: editDueDate || null,
    });
    setSavingEdit(false);
    setEditing(false);
  }

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

  function hasResponded(p: TaskParticipant): boolean {
    if (!p.contact_jid) return true;
    const prefix = p.contact_jid.split("@")[0];
    return respondedNames.has(prefix.toLowerCase()) ||
      Array.from(respondedNames).some((n) => n.includes(prefix));
  }

  const nextStatus = STATUS_FLOW[STATUS_FLOW.indexOf(task.status) + 1];

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
          <button
            onClick={startEdit}
            style={{ background: "transparent", border: "none", color: "#8696a0", fontSize: 13, cursor: "pointer", padding: "4px 8px", marginRight: 4 }}
            title="Editar tarefa"
          >
            ✏️ Editar
          </button>
          <button className="wa-modal-close" onClick={onClose}>×</button>
        </div>

        {/* Edit panel */}
        {editing && (
          <div style={{ padding: "12px 16px", borderBottom: "1px solid rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.03)" }}>
            <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
              <div style={{ flex: 1 }}>
                <label style={{ color: "#8696a0", fontSize: 11, display: "block", marginBottom: 3 }}>Título</label>
                <input
                  className="wa-modal-input"
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  autoFocus
                  style={{ margin: 0 }}
                />
              </div>
              <div>
                <label style={{ color: "#8696a0", fontSize: 11, display: "block", marginBottom: 3 }}>Prioridade</label>
                <select
                  className="wa-modal-input"
                  value={editPriority}
                  onChange={(e) => setEditPriority(e.target.value)}
                  style={{ margin: 0, width: 120 }}
                >
                  {Object.entries(PRIORITY_LABEL).map(([k, v]) => (
                    <option key={k} value={k}>{v}</option>
                  ))}
                </select>
              </div>
              <div>
                <label style={{ color: "#8696a0", fontSize: 11, display: "block", marginBottom: 3 }}>Prazo</label>
                <input
                  className="wa-modal-input"
                  type="date"
                  value={editDueDate}
                  onChange={(e) => setEditDueDate(e.target.value)}
                  style={{ margin: 0, width: 140 }}
                />
              </div>
            </div>
            <div style={{ marginBottom: 8 }}>
              <label style={{ color: "#8696a0", fontSize: 11, display: "block", marginBottom: 3 }}>Descrição</label>
              <textarea
                className="wa-modal-textarea"
                value={editDescription}
                onChange={(e) => setEditDescription(e.target.value)}
                rows={2}
                style={{ margin: 0 }}
              />
            </div>
            {/* Participant management */}
            <div style={{ marginTop: 8, paddingTop: 8, borderTop: "1px solid rgba(255,255,255,0.06)" }}>
              <div style={{ color: "#8696a0", fontSize: 11, marginBottom: 6, fontWeight: 500 }}>
                Membros externos
              </div>
              {participants.filter((p) => !!p.contact_jid).length === 0 && (
                <div style={{ color: "#8696a0", fontSize: 12, marginBottom: 6 }}>Nenhum membro externo.</div>
              )}
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 8 }}>
                {participants.filter((p) => !!p.contact_jid).map((p) => (
                  <span
                    key={p.id}
                    style={{
                      background: p.join_failure ? "rgba(239,68,68,0.12)" : "rgba(0,168,132,0.12)",
                      color: p.join_failure ? "#ef4444" : "#00a884",
                      borderRadius: 999,
                      padding: "3px 10px",
                      fontSize: 12,
                      display: "flex",
                      alignItems: "center",
                      gap: 5,
                    }}
                  >
                    {participantLabel(p)}
                    <button
                      onClick={() => onRemoveParticipant(p.id)}
                      style={{ background: "transparent", border: "none", color: "inherit", cursor: "pointer", padding: 0, fontSize: 13, lineHeight: 1 }}
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
              <input
                className="wa-modal-input"
                placeholder="Buscar contato para adicionar..."
                value={pickerSearch}
                onChange={(e) => setPickerSearch(e.target.value)}
                onFocus={() => setPickerFocused(true)}
                onBlur={() => setTimeout(() => setPickerFocused(false), 150)}
                style={{ margin: 0, marginBottom: 4 }}
              />
              {(pickerFocused || pickerSearch) && (
                <div style={{ maxHeight: 180, overflowY: "auto", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 6 }}>
                  {filteredPicker.length === 0 && pickerExtraContacts.length === 0 && (
                    <div style={{ color: "#8696a0", fontSize: 12, padding: "8px 12px" }}>
                      {pickerSearch ? "Nenhum contato encontrado." : "Digite para buscar contatos..."}
                    </div>
                  )}
                  {filteredPicker.map((c) => (
                    <div
                      key={c.jid}
                      onMouseDown={() => { handleAddParticipant(c); setPickerSearch(""); setPickerFocused(false); }}
                      style={{
                        padding: "7px 12px",
                        cursor: addingParticipant ? "wait" : "pointer",
                        fontSize: 13,
                        color: "#e9edef",
                        borderBottom: "1px solid rgba(255,255,255,0.04)",
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.05)")}
                      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                    >
                      {formatChatName(c.jid, c.name)}
                    </div>
                  ))}
                  {pickerExtraContacts.map((c) => (
                    <div
                      key={c.jid}
                      onMouseDown={() => {
                        handleAddParticipant(c);
                        setPickerSearch(""); setPickerFocused(false);
                      }}
                      style={{
                        padding: "7px 12px",
                        cursor: addingParticipant ? "wait" : "pointer",
                        fontSize: 13,
                        color: "#e9edef",
                        borderBottom: "1px solid rgba(255,255,255,0.04)",
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.05)")}
                      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                    >
                      {c.name || c.jid.split("@")[0]}
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 10 }}>
              <button
                onClick={() => setEditing(false)}
                style={{ background: "transparent", border: "1px solid rgba(255,255,255,0.12)", color: "#8696a0", padding: "5px 14px", borderRadius: 6, fontSize: 12, cursor: "pointer" }}
              >
                Fechar
              </button>
              <button
                onClick={handleSave}
                disabled={!editTitle.trim() || savingEdit}
                style={{ background: "#00a884", border: "none", color: "#111b21", padding: "5px 14px", borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: "pointer", opacity: savingEdit ? 0.6 : 1 }}
              >
                {savingEdit ? "Salvando..." : "Salvar"}
              </button>
            </div>
          </div>
        )}

        {loading && <div style={{ color: "#8696a0", textAlign: "center", padding: 20 }}>Carregando...</div>}

        <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
          {/* Participants column */}
          <div style={{ width: 260, borderRight: "1px solid rgba(255,255,255,0.06)", display: "flex", flexDirection: "column" }}>
            <div style={{ padding: "12px 16px", color: "#8696a0", fontSize: 11, fontWeight: 500, textTransform: "uppercase", letterSpacing: 0.5 }}>
              Participantes ({participants.length})
            </div>
            <div style={{ flex: 1, overflowY: "auto", padding: "0 8px" }}>
              {participants.map((p) => {
                const label = participantLabel(p);
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
                  DM privada para {participantLabel(dmTarget)}
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
