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

function participantCount(task: Task): number {
  return task.task_participants?.length ?? 0;
}

export function TaskListPanel({ tasks, loading, onSelectTask, onCreateTask, onBack }: Props) {
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
          <span style={{ color: "#e9edef", fontSize: 16, fontWeight: 500 }}>Tarefas</span>
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

      {/* List */}
      <div style={{ flex: 1, overflowY: "auto", padding: 0 }}>
        {loading && tasks.length === 0 && (
          <div style={{ color: "#8696a0", textAlign: "center", padding: 40 }}>Carregando...</div>
        )}

        {!loading && tasks.length === 0 && (
          <div style={{ color: "#8696a0", textAlign: "center", padding: 40 }}>
            Nenhuma tarefa ainda.
          </div>
        )}

        {tasks.map((task) => (
          <div
            key={task.id}
            onClick={() => onSelectTask(task)}
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 4,
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

            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <TaskStatusBadge value={task.status} type="status" />
              <TaskStatusBadge value={task.priority} type="priority" />
              {task.due_date && (
                <span style={{ color: "#8696a0", fontSize: 11 }}>
                  Prazo: {formatDate(task.due_date)}
                </span>
              )}
              {participantCount(task) > 0 && (
                <span style={{ color: "#8696a0", fontSize: 11, marginLeft: "auto" }}>
                  {participantCount(task)} participantes
                </span>
              )}
              {task.wa_group_jid && (
                <span style={{ color: "#00a884", fontSize: 10, marginLeft: 6 }}>
                  💬 grupo
                </span>
              )}
            </div>

            {task.description && (
              <span style={{ color: "#8696a0", fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {task.description}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
