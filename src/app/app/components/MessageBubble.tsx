import { useState } from "react";
import { formatMsgTime } from "../lib/formatters";
import type { Message, ReplyTarget } from "../hooks/useMessages";
import { AudioMessage } from "./AudioMessage";
import { ImageMessage } from "./ImageMessage";
import { ContactMessage } from "./ContactMessage";
import { MessageContextMenu } from "./MessageContextMenu";

interface Props {
  msg: Message;
  isGroup: boolean;
  onReply: (target: ReplyTarget) => void;
  onForward: (msg: Message) => void;
}

function StatusTicks({ msg }: { msg: Message }) {
  if (!msg.fromMe) return null;

  // Determine tick state from message id prefix or status
  const isLocal = msg.id.startsWith("local-");
  if (isLocal) {
    // Sending - clock icon
    return (
      <svg className="wa-status-icon" viewBox="0 0 16 16" width="16" height="16">
        <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="1.5"/>
        <path d="M8 4v4l3 2" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
      </svg>
    );
  }

  // Default: delivered (double tick gray)
  return (
    <svg className="wa-status-icon" viewBox="0 0 16 16" width="16" height="16">
      <path d="M1.5 8l3 3 7-7" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M5 8l3 3 7-7" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

export function MessageBubble({ msg, isGroup, onReply, onForward }: Props) {
  const time = formatMsgTime(msg.timestamp);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);

  function handleContextMenu(e: React.MouseEvent) {
    e.preventDefault();
    setMenu({ x: e.clientX, y: e.clientY });
  }

  function renderContent() {
    switch (msg.type) {
      case "audio":
      case "ptt":
        return (
          <AudioMessage
            audioUrl={msg.mediaUrl}
            transcription={msg.transcription}
            transcriptionStatus={msg.transcriptionStatus}
            fromMe={msg.fromMe}
          />
        );
      case "image":
        return (
          <ImageMessage
            imageUrl={msg.mediaUrl}
            caption={msg.mediaCaption}
          />
        );
      case "vcard":
      case "contact":
        if (msg.contact) {
          return <ContactMessage contact={msg.contact} />;
        }
        return (
          <div className="wa-msg-media">
            <span className="wa-msg-media-icon">👤</span>
            <span>Contato</span>
          </div>
        );
      case "video":
        return (
          <div className="wa-msg-media">
            <span className="wa-msg-media-icon">🎬</span>
            <span>{msg.mediaCaption || "Vídeo"}</span>
          </div>
        );
      case "document":
        return (
          <div className="wa-msg-media">
            <span className="wa-msg-media-icon">📄</span>
            <span>{msg.filename || "Documento"}</span>
          </div>
        );
      case "sticker":
        return (
          <div className="wa-msg-media">
            <span className="wa-msg-media-icon">🏷️</span>
            <span>Figurinha</span>
          </div>
        );
      default:
        return <div className="wa-msg-text">{msg.text}</div>;
    }
  }

  return (
    <>
      <div className={`wa-msg ${msg.fromMe ? "out" : "in"}`} onContextMenu={handleContextMenu}>
        <div className="wa-bubble">
          {!msg.fromMe && isGroup && msg.senderName && (
            <div className="wa-msg-sender">{msg.senderName}</div>
          )}
          {renderContent()}
          <span className="wa-msg-time">
            {time}
            <StatusTicks msg={msg} />
          </span>
        </div>
      </div>
      {menu && (
        <MessageContextMenu
          msg={msg}
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          onReply={onReply}
          onForward={onForward}
        />
      )}
    </>
  );
}
