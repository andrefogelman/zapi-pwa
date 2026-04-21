"use client";

import { useMemo, useState } from "react";
import type { Chat } from "../hooks/useChats";
import type { Instance } from "../hooks/useInstances";
import { formatChatName } from "../lib/formatters";

interface Props {
  open: boolean;
  onClose: () => void;
  instances: Instance[];
  activeInstanceId: string | null;
  chats: Chat[];
  onCreate: (input: {
    title: string;
    description?: string;
    priority?: string;
    due_date?: string;
    instance_id?: string;
    participants?: { contact_jid: string; contact_name?: string }[];
  }) => Promise<unknown>;
}

export function TaskCreateModal({
  open, onClose, instances, activeInstanceId, chats, onCreate,
}: Props) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState("medium");
  const [dueDate, setDueDate] = useState("");
  const [selectedInstance, setSelectedInstance] = useState<string | null>(activeInstanceId);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerSearch, setPickerSearch] = useState("");
  const [selected, setSelected] = useState<Record<string, { jid: string; name: string }>>({});
  const [saving, setSaving] = useState(false);

  const dmChats = useMemo(() => chats.filter((c) => !c.isGroup), [chats]);
  const filteredPicker = useMemo(() => {
    const q = pickerSearch.trim().toLowerCase();
    if (!q) return dmChats.slice(0, 40);
    return dmChats.filter((c) =>
      c.name.toLowerCase().includes(q) || c.jid.toLowerCase().includes(q),
    ).slice(0, 40);
  }, [dmChats, pickerSearch]);

  if (!open) return null;

  async function handleSubmit() {
    if (!title.trim() || saving) return;
    setSaving(true);
    const participants = Object.values(selected).map((p) => ({
      contact_jid: p.jid,
      contact_name: p.name,
    }));
    await onCreate({
      title: title.trim(),
      description: description.trim() || undefined,
      priority,
      due_date: dueDate || undefined,
      instance_id: participants.length > 0 ? selectedInstance ?? undefined : undefined,
      participants: participants.length > 0 ? participants : undefined,
    });
    setTitle("");
    setDescription("");
    setPriority("medium");
    setDueDate("");
    setSelected({});
    setPickerOpen(false);
    setSaving(false);
    onClose();
  }

  function togglePick(chat: Chat) {
    const name = formatChatName(chat.jid, chat.name);
    setSelected((prev) => {
      const next = { ...prev };
      if (next[chat.jid]) delete next[chat.jid];
      else next[chat.jid] = { jid: chat.jid, name };
      return next;
    });
  }

  const selectedList = Object.values(selected);
  const willCreateGroup = selectedList.length > 0;

  return (
    <div className="wa-modal-overlay" onClick={onClose}>
      <div className="wa-modal" onClick={(e) => e.stopPropagation()}>
        <div className="wa-modal-header">
          <span className="wa-modal-title">Nova Tarefa</span>
          <button className="wa-modal-close" onClick={onClose}>×</button>
        </div>
        <div className="wa-modal-body" style={{ maxHeight: "70vh", overflowY: "auto" }}>
          <label className="wa-modal-label">Título * {willCreateGroup && <span style={{ color: "#8696a0", fontWeight: 400 }}>(máx. 25 chars — vira nome do grupo)</span>}</label>
          <input
            className="wa-modal-input"
            value={title}
            onChange={(e) => setTitle(e.target.value.slice(0, willCreateGroup ? 25 : 240))}
            placeholder="Ex: Orçamento cliente X"
            autoFocus
          />

          <label className="wa-modal-label" style={{ marginTop: 12 }}>Descrição</label>
          <textarea
            className="wa-modal-textarea"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Detalhes que vão na mensagem de convite do grupo..."
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

          <div style={{ marginTop: 16, paddingTop: 16, borderTop: "1px solid rgba(255,255,255,0.06)" }}>
            <label className="wa-modal-label">Participantes (cria grupo WhatsApp)</label>
            <div style={{ fontSize: 12, color: "#8696a0", marginBottom: 8 }}>
              Convocados recebem mensagem no WhatsApp. Todos se falam no mesmo grupo.
            </div>

            {willCreateGroup && (
              <div style={{ marginBottom: 8 }}>
                <label className="wa-modal-label">Enviar do número</label>
                <select
                  className="wa-modal-input"
                  value={selectedInstance ?? ""}
                  onChange={(e) => setSelectedInstance(e.target.value || null)}
                >
                  {instances.filter((i) => i.waclaw_session_id).map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.name}{i.connected_phone ? ` (${i.connected_phone})` : ""}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
              {selectedList.map((p) => (
                <span
                  key={p.jid}
                  onClick={() => setSelected((prev) => { const n = { ...prev }; delete n[p.jid]; return n; })}
                  style={{
                    background: "rgba(0,168,132,0.18)",
                    color: "#00a884",
                    padding: "4px 10px",
                    borderRadius: 999,
                    fontSize: 12,
                    cursor: "pointer",
                  }}
                  title="Clique para remover"
                >
                  {p.name} ×
                </span>
              ))}
            </div>

            <button
              type="button"
              onClick={() => setPickerOpen((v) => !v)}
              style={{
                background: "transparent",
                border: "1px dashed rgba(255,255,255,0.15)",
                color: "#00a884",
                padding: "8px 14px",
                borderRadius: 8,
                fontSize: 13,
                cursor: "pointer",
                width: "100%",
              }}
            >
              {pickerOpen ? "Fechar" : "+ Adicionar participante"}
            </button>

            {pickerOpen && (
              <div style={{ marginTop: 8, border: "1px solid rgba(255,255,255,0.06)", borderRadius: 8, padding: 8 }}>
                <input
                  className="wa-modal-input"
                  placeholder="Buscar contato..."
                  value={pickerSearch}
                  onChange={(e) => setPickerSearch(e.target.value)}
                  style={{ marginBottom: 6 }}
                />
                <div style={{ maxHeight: 220, overflowY: "auto" }}>
                  {filteredPicker.length === 0 && (
                    <div style={{ color: "#8696a0", fontSize: 12, padding: 8 }}>Nenhum contato.</div>
                  )}
                  {filteredPicker.map((c) => {
                    const picked = !!selected[c.jid];
                    return (
                      <div
                        key={c.jid}
                        onClick={() => togglePick(c)}
                        style={{
                          display: "flex", alignItems: "center", gap: 8,
                          padding: "6px 8px",
                          cursor: "pointer",
                          background: picked ? "rgba(0,168,132,0.08)" : "transparent",
                          borderRadius: 4,
                        }}
                      >
                        <input type="checkbox" checked={picked} readOnly />
                        <span style={{ color: "#e9edef", fontSize: 13 }}>
                          {formatChatName(c.jid, c.name)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="wa-modal-footer">
          <button className="wa-modal-secondary" onClick={onClose}>Cancelar</button>
          <button
            className="wa-modal-primary"
            onClick={handleSubmit}
            disabled={!title.trim() || saving}
          >
            {saving ? "Criando..." : willCreateGroup ? "Criar tarefa + grupo" : "Criar tarefa"}
          </button>
        </div>
      </div>
    </div>
  );
}
