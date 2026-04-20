"use client";

import { useEffect, useRef, useState } from "react";
import { formatMsgTime, formatSenderName } from "../lib/formatters";
import { linkify } from "../lib/linkify";
import type { Message, ReplyTarget } from "../hooks/useMessages";
import { AudioMessage } from "./AudioMessage";
import { ImageMessage } from "./ImageMessage";
import { VideoMessage } from "./VideoMessage";
import { DocumentMessage } from "./DocumentMessage";
import { ContactMessage } from "./ContactMessage";
import { MessageContextMenu } from "./MessageContextMenu";

const LONG_PRESS_MS = 600;

interface Props {
  msg: Message;
  isGroup: boolean;
  onReply: (target: ReplyTarget) => void;
  onForward: (msg: Message) => void;
  onReact: (msg: Message, emoji: string) => Promise<void>;
  onToggleStar: (msgId: string) => Promise<void>;
  onDelete: (msg: Message) => Promise<void>;
  onLinkToTask: (msg: Message) => void;
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

export function MessageBubble({ msg, isGroup, onReply, onForward, onReact, onToggleStar, onDelete, onLinkToTask }: Props) {
  const time = formatMsgTime(msg.timestamp);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);

  // Long-press for touch devices
  const touchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const touchOrigin = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    return () => { if (touchTimer.current) clearTimeout(touchTimer.current); };
  }, []);

  function handleTouchStart(e: React.TouchEvent) {
    const t = e.touches[0];
    touchOrigin.current = { x: t.clientX, y: t.clientY };
    touchTimer.current = setTimeout(() => {
      if (touchOrigin.current) setMenu(touchOrigin.current);
    }, LONG_PRESS_MS);
  }

  function handleTouchMove(e: React.TouchEvent) {
    if (!touchOrigin.current || !touchTimer.current) return;
    const t = e.touches[0];
    const dx = Math.abs(t.clientX - touchOrigin.current.x);
    const dy = Math.abs(t.clientY - touchOrigin.current.y);
    if (dx > 10 || dy > 10) {
      clearTimeout(touchTimer.current);
      touchTimer.current = null;
    }
  }

  function handleTouchEnd() {
    if (touchTimer.current) {
      clearTimeout(touchTimer.current);
      touchTimer.current = null;
    }
  }

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
          <VideoMessage
            videoUrl={msg.mediaUrl}
            caption={msg.mediaCaption}
            mimeType={msg.mimeType}
          />
        );
      case "document":
        return (
          <DocumentMessage
            documentUrl={msg.mediaUrl}
            filename={msg.filename}
            mimeType={msg.mimeType}
          />
        );
      case "sticker":
        return (
          <div className="wa-msg-media">
            <span className="wa-msg-media-icon">🏷️</span>
            <span>Figurinha</span>
          </div>
        );
      default:
        return <div className="wa-msg-text">{linkify(msg.text)}</div>;
    }
  }

  return (
    <>
      <div
        className={`wa-msg ${msg.fromMe ? "out" : "in"}`}
        onContextMenu={handleContextMenu}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handleTouchEnd}
      >
        <div className="wa-bubble">
          {!msg.fromMe && isGroup && (msg.senderName || msg.senderJid) && (
            <div className="wa-msg-sender">{formatSenderName(msg.senderName, msg.senderJid)}</div>
          )}
          {renderContent()}
          {msg.reactions && msg.reactions.length > 0 && (
            <div className="wa-msg-reactions">
              {msg.reactions.map((r) => (
                <span key={r.emoji} className="wa-reaction-chip">
                  <span className="wa-reaction-emoji">{r.emoji}</span>
                  {r.count > 1 && <span className="wa-reaction-count">{r.count}</span>}
                </span>
              ))}
            </div>
          )}
          <span className="wa-msg-time">
            {msg.starred && (
              <svg
                className="wa-msg-star"
                viewBox="0 0 24 24"
                width="12"
                height="12"
                fill="#f59e0b"
              >
                <path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/>
              </svg>
            )}
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
          onReact={onReact}
          onToggleStar={onToggleStar}
          onDelete={onDelete}
          onLinkToTask={onLinkToTask}
        />
      )}
    </>
  );
}
