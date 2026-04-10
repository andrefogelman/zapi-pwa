"use client";

import { useRef, useState } from "react";
import type { ReplyTarget } from "../hooks/useMessages";
import { AttachMenu } from "./AttachMenu";
import { AIImageModal } from "./AIImageModal";

interface Props {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  onSendFile: (file: File, caption?: string) => Promise<void>;
  sending: boolean;
  replyTarget: ReplyTarget | null;
  onCancelReply: () => void;
}

export function MessageInput({
  value,
  onChange,
  onSend,
  onSendFile,
  sending,
  replyTarget,
  onCancelReply,
}: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [aiModalOpen, setAiModalOpen] = useState(false);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const documentInputRef = useRef<HTMLInputElement>(null);
  const contactInputRef = useRef<HTMLInputElement>(null);

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      onSend();
    }
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      await onSendFile(file, value.trim() || undefined);
      onChange("");
    } catch (err) {
      console.error("send file failed:", err);
      alert(`Falha ao enviar: ${(err as Error).message}`);
    }
  }

  return (
    <div className="wa-input-wrap">
      {replyTarget && (
        <div className="wa-reply-preview">
          <div className="wa-reply-bar">
            <div className="wa-reply-name">{replyTarget.fromMe ? "Você" : replyTarget.senderName}</div>
            <div className="wa-reply-text">{replyTarget.text?.slice(0, 100) || "..."}</div>
          </div>
          <button className="wa-reply-close" onClick={onCancelReply}>✕</button>
        </div>
      )}
      <div className="wa-input-row">
        <div className="wa-attach-wrap">
          <button
            className="wa-attach-btn"
            onClick={() => setMenuOpen((v) => !v)}
            disabled={sending}
            title="Anexar"
          >
            <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor">
              <path d="M1.816 15.556v.002c0 1.502.584 2.912 1.646 3.972s2.472 1.647 3.974 1.647a5.58 5.58 0 0 0 3.972-1.645l9.547-9.548c.769-.768 1.147-1.767 1.058-2.817-.079-.968-.548-1.927-1.319-2.698-1.594-1.592-4.068-1.711-5.517-.262l-7.916 7.915c-.881.881-.792 2.25.214 3.261.959.958 2.423 1.053 3.263.215l5.511-5.512c.28-.28.267-.722.053-.936l-.244-.244c-.191-.191-.567-.349-.957.04l-5.506 5.506c-.18.18-.635.127-.976-.214-.098-.097-.576-.613-.213-.973l7.915-7.917c.818-.817 2.267-.699 3.23.262.5.501.802 1.1.849 1.685.051.573-.156 1.111-.589 1.543l-9.547 9.549a3.97 3.97 0 0 1-2.829 1.171 3.975 3.975 0 0 1-2.83-1.173 3.973 3.973 0 0 1-1.172-2.828c0-1.071.415-2.076 1.172-2.83l7.209-7.211c.157-.157.264-.579.028-.814L11.5 4.36a.572.572 0 0 0-.834.018l-7.205 7.207a5.577 5.577 0 0 0-1.645 3.971z"/>
            </svg>
          </button>
          <AttachMenu
            open={menuOpen}
            onClose={() => setMenuOpen(false)}
            onPickPhoto={() => photoInputRef.current?.click()}
            onPickDocument={() => documentInputRef.current?.click()}
            onPickContact={() => contactInputRef.current?.click()}
            onPickAIImage={() => setAiModalOpen(true)}
          />
        </div>
        <input
          className="wa-input"
          placeholder="Digite uma mensagem"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={sending}
        />
        <button className="wa-send-btn" onClick={onSend} disabled={!value.trim() || sending}>
          <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor">
            <path d="M1.101 21.757L23.8 12.028 1.101 2.3l.011 7.912 13.623 1.816-13.623 1.817-.011 7.912z"/>
          </svg>
        </button>
      </div>

      {/* Hidden file inputs */}
      <input
        ref={photoInputRef}
        type="file"
        accept="image/*,video/*"
        hidden
        onChange={handleFileChange}
      />
      <input
        ref={documentInputRef}
        type="file"
        hidden
        onChange={handleFileChange}
      />
      <input
        ref={contactInputRef}
        type="file"
        accept=".vcf,text/vcard"
        hidden
        onChange={handleFileChange}
      />

      <AIImageModal
        open={aiModalOpen}
        onClose={() => setAiModalOpen(false)}
        onSendGenerated={onSendFile}
      />
    </div>
  );
}
