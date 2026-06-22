"use client";

import { useState, useMemo } from "react";
import { TaskStatusBadge } from "./TaskStatusBadge";
import type { Task } from "../hooks/useTasks";

interface Props {
  tasks: Task[];
  loading: boolean;
  onSelectTask: (task: Task) => void;
  onCreateTask: () => void;
  onBack: () => void;
}

function formatDate(iso: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
}

const STATUS_OPTS = [
  { key: "all", label: "Todas" },
  { key: "open", label: "Abertas" },
  { key: "in_progress", label: "Em andamento" },
  { key: "resolved", label: "Resolvidas" },
  { key: "closed", label: "Fechadas" },
] as const;

type StatusKey = typeof STATUS_OPTS[number]["key"];

export function TaskListPanel({ tasks, loading, onSelectTask, onCreateTask, onBack }: Props) {
  const [statusFilter, setStatusFilter] = useState<StatusKey>("all");

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: tasks.length, open: 0, in_progress: 0, resolved: 0, closed: 0 };
    for (const t of tasks) c[t.status] = (c[t.status] ?? 0) + 1;
    return c;
  }, [tasks]);

  const filtered = useMemo(() =>
    statusFilter === "all" ? tasks : tasks.filter((t) => t.status === statusFilter),
    [tasks, statusFilter],
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {/* Header */}
      <div className="wa-chat-header" style={{ justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button
            onClick={onBack}
            style={{ background: "transparent", border: "none", color: "#8696a0", fontSize: 20, cursor: "pointer" }}
          >
            ←
          </button>
          <div>
            <div style={{ color: "#e9edef", fontSize: 16, fontWeight: 500 }}>Tarefas</div>
            <div style={{ color: "#8696a0", fontSize: 11 }}>
              {counts.open} abertas · {counts.in_progress} em andamento · {counts.resolved} resolvidas
            </div>
          </div>
        </div>
        <button
          onClick={onCreateTask}
          style={{
            background: "#00a884",
            border: "none",
            color: "#111b21",
            padding: "6px 14px",
            borderRadius: 6,
            fontSize: 13,
            fontWeight: 500,
            cursor: "pointer",
          }}
        >
          + Nova
        </button>
      </div>

      {/* Status filter chips */}
      <div style={{ display: "flex", gap: 6, padding: "8px 12px", overflowX: "auto", borderBottom: "1px solid rgba(255,255,255,0.06)", flexShrink: 0 }}>
        {STATUS_OPTS.map((opt) => {
          const active = statusFilter === opt.key;
          const count = counts[opt.key] ?? 0;
          if (opt.key !== "all" && count === 0) return null;
          return (
            <button
              key={opt.key}
              onClick={() => setStatusFilter(opt.key)}
              style={{
                background: active ? "#00a884" : "rgba(255,255,255,0.06)",
                color: active ? "#111b21" : "#aebac1",
                border: "none",
                borderRadius: 999,
                padding: "4px 12px",
                fontSize: 12,
                fontWeight: active ? 600 : 400,
                cursor: "pointer",
                whiteSpace: "nowrap",
                display: "flex",
                alignItems: "center",
                gap: 5,
              }}
            >
              {opt.label}
              <span style={{
                background: active ? "rgba(17,27,33,0.25)" : "rgba(255,255,255,0.12)",
                borderRadius: 999,
                padding: "0 5px",
                fontSize: 10,
                fontWeight: 700,
              }}>
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {/* List */}
      <div style={{ flex: 1, overflowY: "auto", padding: 0 }}>
        {loading && filtered.length === 0 && (
          <div style={{ color: "#8696a0", textAlign: "center", padding: 40 }}>Carregando...</div>
        )}

        {!loading && filtered.length === 0 && (
          <div style={{ color: "#8696a0", textAlign: "center", padding: 40 }}>
            {statusFilter !== "all"
              ? `Nenhuma tarefa com status "${STATUS_OPTS.find((o) => o.key === statusFilter)?.label}".`
              : "Nenhuma tarefa ainda."}
          </div>
        )}

        {filtered.map((task) => {
          const participants = task.task_participants ?? [];
          const externals = participants.filter((p) => !!p.contact_jid);
          const overdue = task.due_date && new Date(task.due_date) < new Date();
          return (
            <div
              key={task.id}
              onClick={() => onSelectTask(task)}
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 5,
                padding: "12px 16px",
                borderBottom: "1px solid rgba(255,255,255,0.06)",
                cursor: "pointer",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.04)")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span style={{ color: "#e9edef", fontSize: 14, fontWeight: 500, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {task.title}
                </span>
                <span style={{ color: "#8696a0", fontSize: 11, marginLeft: 8, whiteSpace: "nowrap" }}>
                  {formatDate(task.created_at)}
                </span>
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                <TaskStatusBadge value={task.status} type="status" />
                <TaskStatusBadge value={task.priority} type="priority" />
                {task.due_date && (
                  <span style={{ color: overdue ? "#ef4444" : "#8696a0", fontSize: 11 }}>
                    📅 {formatDate(task.due_date)}
                  </span>
                )}
                {task.wa_group_jid && (
                  <span style={{ color: "#00a884", fontSize: 10 }}>💬 grupo</span>
                )}
              </div>

              {task.description && (
                <span style={{ color: "#8696a0", fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {task.description}
                </span>
              )}

              {externals.length > 0 && (
                <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                  {externals.slice(0, 4).map((p) => {
                    const name = p.contact_name || p.contact_jid?.split("@")[0] || "?";
                    const failed = !!p.join_failure;
                    return (
                      <span
                        key={p.id}
                        style={{
                          background: failed ? "rgba(239,68,68,0.1)" : "rgba(0,168,132,0.1)",
                          color: failed ? "#ef4444" : "#00a884",
                          borderRadius: 999,
                          padding: "1px 7px",
                          fontSize: 10,
                        }}
                        title={failed ? (p.join_failure ?? "") : ""}
                      >
                        {failed ? "⚠ " : ""}{name}
                      </span>
                    );
                  })}
                  {externals.length > 4 && (
                    <span style={{ color: "#8696a0", fontSize: 10, alignSelf: "center" }}>
                      +{externals.length - 4}
                    </span>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
