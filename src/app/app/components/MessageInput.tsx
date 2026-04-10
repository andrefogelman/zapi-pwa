import type { ReplyTarget } from "../hooks/useMessages";

interface Props {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  sending: boolean;
  replyTarget: ReplyTarget | null;
  onCancelReply: () => void;
}

export function MessageInput({ value, onChange, onSend, sending, replyTarget, onCancelReply }: Props) {
  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      onSend();
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
    </div>
  );
}
