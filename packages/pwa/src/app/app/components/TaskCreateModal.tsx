import { useState } from "react";

interface Props {
  open: boolean;
  onClose: () => void;
  onCreate: (input: {
    title: string;
    description?: string;
    priority?: string;
    due_date?: string;
  }) => Promise<unknown>;
}

export function TaskCreateModal({ open, onClose, onCreate }: Props) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState("medium");
  const [dueDate, setDueDate] = useState("");
  const [saving, setSaving] = useState(false);

  if (!open) return null;

  async function handleSubmit() {
    if (!title.trim() || saving) return;
    setSaving(true);
    await onCreate({
      title: title.trim(),
      description: description.trim() || undefined,
      priority,
      due_date: dueDate || undefined,
    });
    setTitle("");
    setDescription("");
    setPriority("medium");
    setDueDate("");
    setSaving(false);
    onClose();
  }

  return (
    <div className="wa-modal-overlay" onClick={onClose}>
      <div className="wa-modal" onClick={(e) => e.stopPropagation()}>
        <div className="wa-modal-header">
          <span className="wa-modal-title">Nova Tarefa</span>
          <button className="wa-modal-close" onClick={onClose}>×</button>
        </div>
        <div className="wa-modal-body">
          <label className="wa-modal-label">Título *</label>
          <input
            className="wa-modal-input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Ex: Resolver problema do cliente"
            autoFocus
            onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
          />

          <label className="wa-modal-label" style={{ marginTop: 12 }}>Descrição</label>
          <textarea
            className="wa-modal-textarea"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Detalhes opcionais..."
            rows={3}
          />

          <div style={{ display: "flex", gap: 12, marginTop: 12 }}>
            <div style={{ flex: 1 }}>
              <label className="wa-modal-label">Prioridade</label>
              <select
                className="wa-modal-input"
                value={priority}
                onChange={(e) => setPriority(e.target.value)}
              >
                <option value="low">Baixa</option>
                <option value="medium">Média</option>
                <option value="high">Alta</option>
                <option value="urgent">Urgente</option>
              </select>
            </div>
            <div style={{ flex: 1 }}>
              <label className="wa-modal-label">Prazo</label>
              <input
                className="wa-modal-input"
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
              />
            </div>
          </div>
        </div>
        <div className="wa-modal-footer">
          <button className="wa-modal-secondary" onClick={onClose}>Cancelar</button>
          <button
            className="wa-modal-primary"
            onClick={handleSubmit}
            disabled={!title.trim() || saving}
          >
            {saving ? "Criando..." : "Criar Tarefa"}
          </button>
        </div>
      </div>
    </div>
  );
}
