import { useState } from "react";
import { TaskStatusBadge } from "./TaskStatusBadge";
import type { Task } from "../hooks/useTasks";

interface Props {
  open: boolean;
  title: string;
  tasks: Task[];
  onSelect: (task: Task) => void;
  onCreate: (title: string) => void;
  onClose: () => void;
}

export function TaskPickerModal({ open, title, tasks, onSelect, onCreate, onClose }: Props) {
  const [input, setInput] = useState("");

  if (!open) return null;

  const filtered = input.trim()
    ? tasks.filter((t) =>
        t.title.toLowerCase().includes(input.toLowerCase()) ||
        (t.description || "").toLowerCase().includes(input.toLowerCase())
      )
    : tasks;

  const active = filtered.filter((t) => t.status === "open" || t.status === "in_progress");

  function handleCreate() {
    const name = input.trim();
    if (!name) return;
    onCreate(name);
    setInput("");
  }

  return (
    <div className="wa-modal-overlay" onClick={onClose}>
      <div className="wa-modal" onClick={(e) => e.stopPropagation()}>
        <div className="wa-modal-header">
          <span className="wa-modal-title">{title}</span>
          <button className="wa-modal-close" onClick={onClose}>×</button>
        </div>

        {/* Input: busca OU cria */}
        <div style={{ padding: "8px 16px" }}>
          <div style={{ display: "flex", gap: 8 }}>
            <input
              className="wa-modal-search"
              style={{ flex: 1 }}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Buscar ou criar tarefa..."
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter" && input.trim()) {
                  if (active.length > 0) {
                    onSelect(active[0]);
                  } else {
                    handleCreate();
                  }
                }
              }}
            />
            <button
              onClick={handleCreate}
              disabled={!input.trim()}
              style={{
                background: "#00a884",
                border: "none",
                color: "#111b21",
                padding: "8px 14px",
                borderRadius: 8,
                fontSize: 13,
                fontWeight: 600,
                cursor: input.trim() ? "pointer" : "default",
                opacity: input.trim() ? 1 : 0.4,
                whiteSpace: "nowrap",
              }}
            >
              + Criar
            </button>
          </div>
        </div>

        <div className="wa-modal-body" style={{ padding: 0, maxHeight: 400 }}>
          {/* Create suggestion when no match */}
          {input.trim() && active.length === 0 && (
            <div
              onClick={handleCreate}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "14px 16px",
                cursor: "pointer",
                background: "rgba(0,168,132,0.08)",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(0,168,132,0.15)")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "rgba(0,168,132,0.08)")}
            >
              <span style={{ color: "#00a884", fontSize: 20, fontWeight: 300, lineHeight: 1 }}>+</span>
              <span style={{ color: "#00a884", fontSize: 14 }}>
                Criar tarefa: <strong>{input.trim()}</strong>
              </span>
            </div>
          )}

          {/* Empty state without input */}
          {!input.trim() && active.length === 0 && (
            <div style={{ color: "#8696a0", textAlign: "center", padding: 30, fontSize: 13 }}>
              Digite o nome da tarefa acima e clique "+ Criar"
            </div>
          )}

          {/* Task list */}
          {active.map((task) => (
            <div
              key={task.id}
              onClick={() => onSelect(task)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "10px 16px",
                cursor: "pointer",
                borderBottom: "1px solid rgba(255,255,255,0.04)",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.06)")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
            >
              <div style={{ flex: 1, overflow: "hidden" }}>
                <div style={{ color: "#e9edef", fontSize: 14, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {task.title}
                </div>
                {task.description && (
                  <div style={{ color: "#8696a0", fontSize: 11, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {task.description}
                  </div>
                )}
              </div>
              <TaskStatusBadge value={task.priority} type="priority" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
