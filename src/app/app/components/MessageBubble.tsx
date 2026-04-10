import { formatMsgTime } from "../lib/formatters";
import type { Message, ReplyTarget } from "../hooks/useMessages";

interface Props {
  msg: Message;
  isGroup: boolean;
  onReply: (target: ReplyTarget) => void;
}

export function MessageBubble({ msg, isGroup, onReply }: Props) {
  const time = formatMsgTime(msg.timestamp);

  function handleContextMenu(e: React.MouseEvent) {
    e.preventDefault();
    onReply({
      id: msg.id,
      senderName: msg.fromMe ? "Você" : msg.senderName,
      text: msg.text,
      fromMe: msg.fromMe,
    });
  }

  return (
    <div className={`wa-msg ${msg.fromMe ? "out" : "in"}`} onContextMenu={handleContextMenu}>
      <div className="wa-bubble">
        {!msg.fromMe && isGroup && msg.senderName && (
          <div className="wa-msg-sender">{msg.senderName}</div>
        )}
        {msg.type === "audio" || msg.type === "ptt" ? (
          <div className="wa-msg-media"><span className="wa-msg-media-icon">🎵</span><span>Mensagem de voz</span></div>
        ) : msg.type === "image" ? (
          <div className="wa-msg-media"><span className="wa-msg-media-icon">📷</span><span>{msg.mediaCaption || "Foto"}</span></div>
        ) : msg.type === "video" ? (
          <div className="wa-msg-media"><span className="wa-msg-media-icon">🎬</span><span>{msg.mediaCaption || "Vídeo"}</span></div>
        ) : msg.type === "document" ? (
          <div className="wa-msg-media"><span className="wa-msg-media-icon">📄</span><span>{msg.filename || "Documento"}</span></div>
        ) : msg.type === "sticker" ? (
          <div className="wa-msg-media"><span className="wa-msg-media-icon">🏷️</span><span>Figurinha</span></div>
        ) : (
          <div className="wa-msg-text">{msg.text}</div>
        )}
        <span className="wa-msg-time">{time}</span>
      </div>
    </div>
  );
}
