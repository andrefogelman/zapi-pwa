import { useState } from "react";
import { TaskStatusBadge } from "./TaskStatusBadge";
import type { Task, TaskComment, TaskConversation, TaskMessage, TaskParticipant } from "../hooks/useTasks";

interface Props {
  task: Task | null;
  comments: TaskComment[];
  loading: boolean;
  onClose: () => void;
  onUpdateStatus: (status: string) => void;
  onAddComment: (body: string) => Promise<unknown>;
  onRemoveParticipant: (id: string) => void;
  onRemoveConversation: (id: string) => void;
  onUnpinMessage: (id: string) => void;
  onNavigateToChat: (chatJid: string) => void;
  onDelete: () => void;
}

function formatTs(iso: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleString("pt-BR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

const STATUS_FLOW = ["open", "in_progress", "resolved", "closed"];

export function TaskDetailModal({
  task, comments, loading, onClose,
  onUpdateStatus, onAddComment,
  onRemoveParticipant, onRemoveConversation, onUnpinMessage, onNavigateToChat, onDelete,
}: Props) {
  const [commentInput, setCommentInput] = useState("");
  const [sending, setSending] = useState(false);
  const [activeTab, setActiveTab] = useState<"thread" | "links">("thread");
  const [expandedMsg, setExpandedMsg] = useState<string | null>(null);

  if (!task) return null;

  const participants = (task.task_participants || []) as TaskParticipant[];
  const conversations = (task.task_conversations || []) as TaskConversation[];
  const messages = (task.task_messages || []) as TaskMessage[];

  async function handleSendComment() {
    if (!commentInput.trim() || sending) return;
    setSending(true);
    await onAddComment(commentInput.trim());
    setCommentInput("");
    setSending(false);
  }

  const nextStatus = STATUS_FLOW[STATUS_FLOW.indexOf(task.status) + 1];

  return (
    <div className="wa-modal-overlay" onClick={onClose}>
      <div className="wa-modal wa-modal-lg" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 600, height: "85vh" }}>
        {/* Header */}
        <div className="wa-modal-header">
          <div style={{ flex: 1 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
              <span className="wa-modal-title" style={{ flex: 1 }}>{task.title}</span>
              <button
                onClick={() => { if (confirm("Excluir esta tarefa?")) onDelete(); }}
                style={{ background: "transparent", border: "none", color: "#ef4444", fontSize: 12, cursor: "pointer", padding: "4px 8px", borderRadius: 4 }}
                title="Excluir tarefa"
              >
                Excluir
              </button>
              <button className="wa-modal-close" onClick={onClose}>×</button>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <TaskStatusBadge value={task.status} type="status" />
              <TaskStatusBadge value={task.priority} type="priority" />
              {task.due_date && (
                <span style={{ color: "#8696a0", fontSize: 11 }}>
                  Prazo: {formatTs(task.due_date)}
                </span>
              )}
              {nextStatus && (
                <button
                  onClick={() => onUpdateStatus(nextStatus)}
                  style={{
                    marginLeft: "auto",
                    background: "rgba(255,255,255,0.08)",
                    border: "none",
                    color: "#00a884",
                    padding: "3px 10px",
                    borderRadius: 4,
                    fontSize: 11,
                    cursor: "pointer",
                  }}
                >
                  → {nextStatus === "in_progress" ? "Em andamento" : nextStatus === "resolved" ? "Resolver" : "Fechar"}
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Description */}
        {task.description && (
          <div style={{ padding: "8px 20px", color: "#8696a0", fontSize: 13, borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
            {task.description}
          </div>
        )}

        {/* Tabs */}
        <div className="wa-modal-tabs" style={{ display: "flex", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
          {(["thread", "links"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              style={{
                flex: 1,
                padding: "10px 0",
                background: "transparent",
                border: "none",
                borderBottom: activeTab === tab ? "2px solid #00a884" : "2px solid transparent",
                color: activeTab === tab ? "#00a884" : "#8696a0",
                fontSize: 13,
                cursor: "pointer",
              }}
            >
              {tab === "thread" ? `Discussão (${comments.length})` : `Links (${participants.length + conversations.length + messages.length})`}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="wa-modal-body" style={{ flex: 1, padding: 0 }}>
          {loading && <div style={{ color: "#8696a0", textAlign: "center", padding: 20 }}>Carregando...</div>}

          {activeTab === "thread" && (
            <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
              {/* Comments + pinned messages */}
              <div style={{ flex: 1, overflowY: "auto", padding: "12px 16px" }}>
                {/* Pinned messages at top */}
                {messages.length > 0 && (
                  <div style={{ marginBottom: 12 }}>
                    {messages.map((m) => (
                      <div
                        key={m.id}
                        style={{
                          background: "rgba(0,168,132,0.08)",
                          borderLeft: "3px solid #00a884",
                          borderRadius: "0 8px 8px 0",
                          padding: "8px 12px",
                          marginBottom: 6,
                        }}
                      >
                        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 2 }}>
                          <span style={{ color: "#00a884", fontSize: 11, fontWeight: 500 }}>
                            📌 {m.sender_name || "—"}
                          </span>
                          <span style={{ color: "#8696a0", fontSize: 10 }}>{m.message_ts ? formatTs(m.message_ts) : ""}</span>
                        </div>
                        <div style={{ color: "#e9edef", fontSize: 13, whiteSpace: "pre-wrap" }}>
                          {m.snippet || "[mídia]"}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {comments.length === 0 && messages.length === 0 && (
                  <div style={{ color: "#8696a0", textAlign: "center", padding: 20, fontSize: 13 }}>
                    Nenhum comentário ainda. Inicie a discussão.
                  </div>
                )}
                {comments.map((c) => (
                  <div
                    key={c.id}
                    style={{
                      background: "rgba(255,255,255,0.04)",
                      borderRadius: 8,
                      padding: "8px 12px",
                      marginBottom: 8,
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 2 }}>
                      <span style={{ color: "#00a884", fontSize: 11, fontWeight: 500 }}>
                        {c.author_id.slice(0, 8)}
                      </span>
                      <span style={{ color: "#8696a0", fontSize: 10 }}>{formatTs(c.created_at)}</span>
                    </div>
                    <div style={{ color: "#e9edef", fontSize: 13, whiteSpace: "pre-wrap" }}>{c.body}</div>
                  </div>
                ))}
              </div>

              {/* Comment input */}
              <div style={{ padding: "8px 12px", borderTop: "1px solid rgba(255,255,255,0.06)", display: "flex", gap: 8 }}>
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
                  value={commentInput}
                  onChange={(e) => setCommentInput(e.target.value)}
                  placeholder="Escreva um comentário..."
                  onKeyDown={(e) => e.key === "Enter" && handleSendComment()}
                />
                <button
                  onClick={handleSendComment}
                  disabled={!commentInput.trim() || sending}
                  style={{
                    background: "#00a884",
                    border: "none",
                    color: "#111b21",
                    padding: "8px 14px",
                    borderRadius: 8,
                    fontSize: 13,
                    fontWeight: 500,
                    cursor: "pointer",
                    opacity: !commentInput.trim() || sending ? 0.5 : 1,
                  }}
                >
                  Enviar
                </button>
              </div>
            </div>
          )}

          {activeTab === "links" && (
            <div style={{ padding: "12px 16px" }}>
              {/* Participants */}
              <div style={{ marginBottom: 16 }}>
                <div style={{ color: "#8696a0", fontSize: 11, fontWeight: 500, marginBottom: 6, textTransform: "uppercase" }}>
                  Participantes ({participants.length})
                </div>
                {participants.map((p) => (
                  <div key={p.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "4px 0" }}>
                    <span style={{ color: "#e9edef", fontSize: 13 }}>
                      {p.contact_jid || p.user_id?.slice(0, 8) || "—"}
                      <span style={{ color: "#8696a0", fontSize: 11, marginLeft: 6 }}>{p.role}</span>
                    </span>
                    {p.role !== "owner" && (
                      <button
                        onClick={() => onRemoveParticipant(p.id)}
                        style={{ background: "transparent", border: "none", color: "#ef4444", fontSize: 12, cursor: "pointer" }}
                      >
                        remover
                      </button>
                    )}
                  </div>
                ))}
              </div>

              {/* Conversations */}
              <div style={{ marginBottom: 16 }}>
                <div style={{ color: "#8696a0", fontSize: 11, fontWeight: 500, marginBottom: 6, textTransform: "uppercase" }}>
                  Conversas ({conversations.length})
                </div>
                {conversations.map((c) => (
                  <div key={c.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "4px 0" }}>
                    <span
                      style={{ color: "#53bdeb", fontSize: 13, cursor: "pointer", textDecoration: "underline", textDecorationColor: "rgba(83,189,235,0.3)" }}
                      onClick={() => { onNavigateToChat(c.chat_jid); onClose(); }}
                      title="Ir para conversa"
                    >
                      {c.chat_name || c.chat_jid}
                    </span>
                    <button
                      onClick={() => onRemoveConversation(c.id)}
                      style={{ background: "transparent", border: "none", color: "#ef4444", fontSize: 12, cursor: "pointer" }}
                    >
                      desvincular
                    </button>
                  </div>
                ))}
                {conversations.length === 0 && (
                  <span style={{ color: "#8696a0", fontSize: 12 }}>Nenhuma conversa vinculada</span>
                )}
              </div>

              {/* Pinned messages */}
              <div>
                <div style={{ color: "#8696a0", fontSize: 11, fontWeight: 500, marginBottom: 6, textTransform: "uppercase" }}>
                  Mensagens fixadas ({messages.length})
                </div>
                {messages.map((m) => (
                  <div key={m.id} style={{ padding: "6px 0", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                      <div style={{ flex: 1, overflow: "hidden" }}>
                        <span style={{ color: "#00a884", fontSize: 11 }}>{m.sender_name || "—"}</span>
                        <span style={{ color: "#e9edef", fontSize: 12, marginLeft: 6 }}>
                          {expandedMsg === m.id
                            ? ""
                            : m.snippet
                              ? (m.snippet.length > 60 ? m.snippet.slice(0, 60) + "..." : m.snippet)
                              : "[mídia]"
                          }
                        </span>
                      </div>
                      <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
                        {m.snippet && (
                          <button
                            onClick={() => setExpandedMsg(expandedMsg === m.id ? null : m.id)}
                            style={{ background: "transparent", border: "none", color: "#53bdeb", fontSize: 12, cursor: "pointer" }}
                          >
                            {expandedMsg === m.id ? "fechar" : "ver"}
                          </button>
                        )}
                        <button
                          onClick={() => onUnpinMessage(m.id)}
                          style={{ background: "transparent", border: "none", color: "#ef4444", fontSize: 12, cursor: "pointer" }}
                        >
                          desafixar
                        </button>
                      </div>
                    </div>
                    {expandedMsg === m.id && m.snippet && (
                      <div style={{
                        marginTop: 6,
                        padding: "8px 12px",
                        background: "rgba(255,255,255,0.04)",
                        borderRadius: 8,
                        borderLeft: "3px solid #00a884",
                        color: "#e9edef",
                        fontSize: 13,
                        whiteSpace: "pre-wrap",
                        lineHeight: 1.4,
                      }}>
                        {m.snippet}
                      </div>
                    )}
                  </div>
                ))}
                {messages.length === 0 && (
                  <span style={{ color: "#8696a0", fontSize: 12 }}>Nenhuma mensagem fixada</span>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
