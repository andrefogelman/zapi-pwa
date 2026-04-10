"use client";

import { useState } from "react";
import { useAuth } from "@/lib/use-auth";

interface Props {
  open: boolean;
  onClose: () => void;
  onSendGenerated: (file: File, caption?: string) => Promise<void>;
}

export function AIImageModal({ open, onClose, onSendGenerated }: Props) {
  const { session } = useAuth();
  const [prompt, setPrompt] = useState("");
  const [generating, setGenerating] = useState(false);
  const [sending, setSending] = useState(false);
  const [preview, setPreview] = useState<{ base64: string; mimeType: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  function reset() {
    setPrompt("");
    setPreview(null);
    setError(null);
    setGenerating(false);
    setSending(false);
  }

  function handleClose() {
    reset();
    onClose();
  }

  async function handleGenerate() {
    if (!prompt.trim() || generating || !session?.access_token) return;
    setGenerating(true);
    setError(null);
    try {
      const res = await fetch("/api/ai-image", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ prompt: prompt.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      setPreview({ base64: data.base64, mimeType: data.mimeType });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setGenerating(false);
    }
  }

  async function handleSend() {
    if (!preview || sending) return;
    setSending(true);
    try {
      const bytes = Uint8Array.from(atob(preview.base64), (c) => c.charCodeAt(0));
      const blob = new Blob([bytes], { type: preview.mimeType });
      const file = new File([blob], `ai-${Date.now()}.png`, { type: preview.mimeType });
      await onSendGenerated(file, prompt);
      handleClose();
    } catch (err) {
      setError((err as Error).message);
      setSending(false);
    }
  }

  return (
    <div className="wa-modal-overlay" onClick={handleClose}>
      <div className="wa-modal" onClick={(e) => e.stopPropagation()}>
        <div className="wa-modal-header">
          <div className="wa-modal-title">Gerar imagem com IA</div>
          <button className="wa-modal-close" onClick={handleClose}>✕</button>
        </div>

        <div className="wa-modal-body">
          {!preview ? (
            <>
              <label className="wa-modal-label">Descreva a imagem:</label>
              <textarea
                className="wa-modal-textarea"
                placeholder="Ex: uma fachada de casa moderna com jardim vertical"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                disabled={generating}
                rows={4}
                autoFocus
              />
              {error && <div className="wa-modal-error">{error}</div>}
            </>
          ) : (
            <>
              <img
                src={`data:${preview.mimeType};base64,${preview.base64}`}
                alt={prompt}
                className="wa-modal-preview"
              />
              <div className="wa-modal-caption">{prompt}</div>
              {error && <div className="wa-modal-error">{error}</div>}
            </>
          )}
        </div>

        <div className="wa-modal-footer">
          {!preview ? (
            <button
              className="wa-modal-primary"
              onClick={handleGenerate}
              disabled={!prompt.trim() || generating}
            >
              {generating ? "Gerando..." : "Gerar"}
            </button>
          ) : (
            <>
              <button
                className="wa-modal-secondary"
                onClick={() => setPreview(null)}
                disabled={sending}
              >
                Tentar outra
              </button>
              <button
                className="wa-modal-primary"
                onClick={handleSend}
                disabled={sending}
              >
                {sending ? "Enviando..." : "Enviar"}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
