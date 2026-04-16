import { useState } from "react";
import { TaskStatusBadge } from "./TaskStatusBadge";
import type { Task } from "../hooks/useTasks";

interface Props {
  open: boolean;
  title: string;
  tasks: Task[];
  onSelect: (task: Task) => void;
  onClose: () => void;
}

export function TaskPickerModal({ open, title, tasks, onSelect, onClose }: Props) {
  const [search, setSearch] = useState("");

  if (!open) return null;

  const filtered = search.trim()
    ? tasks.filter((t) =>
        t.title.toLowerCase().includes(search.toLowerCase()) ||
        (t.description || "").toLowerCase().includes(search.toLowerCase())
      )
    : tasks;

  // Only show open/in_progress tasks
  const active = filtered.filter((t) => t.status === "open" || t.status === "in_progress");

  return (
    <div className="wa-modal-overlay" onClick={onClose}>
      <div className="wa-modal" onClick={(e) => e.stopPropagation()}>
        <div className="wa-modal-header">
          <span className="wa-modal-title">{title}</span>
          <button className="wa-modal-close" onClick={onClose}>×</button>
        </div>
        <div style={{ padding: "8px 16px" }}>
          <input
            className="wa-modal-search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar tarefa..."
            autoFocus
          />
        </div>
        <div className="wa-modal-body" style={{ padding: 0, maxHeight: 400 }}>
          {active.length === 0 && (
            <div style={{ color: "#8696a0", textAlign: "center", padding: 30, fontSize: 13 }}>
              {tasks.length === 0 ? "Nenhuma tarefa criada ainda." : "Nenhuma tarefa ativa encontrada."}
            </div>
          )}
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
