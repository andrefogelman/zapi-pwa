"use client";

import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/lib/use-auth";
import { Sidebar } from "./components/Sidebar";
import { ChatPanel } from "./components/ChatPanel";
import { EmptyState } from "./components/EmptyState";
import { SettingsModal } from "./components/SettingsModal";
import { ForwardPickerModal } from "./components/ForwardPickerModal";
import { SummaryModal } from "./components/SummaryModal";
import { ScheduleMessageModal } from "./components/ScheduleMessageModal";
import { useChats, type Chat } from "./hooks/useChats";
import { useMessages, type Message } from "./hooks/useMessages";
import { useInstances } from "./hooks/useInstances";
import { useWaclaw } from "./hooks/useWaclaw";
import { QRConnectWizard } from "./components/QRConnectWizard";

export default function AppMain() {
  const { session, signOut } = useAuth();
  const { instances, loading: instLoading, reload, createWaclaw, remove, rename } = useInstances();
  const [activeInstanceId, setActiveInstanceId] = useState<string | null>(null);
  const [selectedChat, setSelectedChat] = useState<Chat | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [forwardTarget, setForwardTarget] = useState<Message | null>(null);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);

  // Auto-select the first waclaw-enabled instance once the list loads
  useEffect(() => {
    if (activeInstanceId) return;
    const firstWithSession = instances.find((i) => i.waclaw_session_id);
    if (firstWithSession) setActiveInstanceId(firstWithSession.id);
  }, [instances, activeInstanceId]);

  const activeInstance = useMemo(
    () => instances.find((i) => i.id === activeInstanceId) || null,
    [instances, activeInstanceId]
  );
  const sessionId = activeInstance?.waclaw_session_id || null;

  const { chats, loading: chatsLoading, search, setSearch, activeTab, setActiveTab, tabCounts, markAsRead } = useChats(sessionId);
  const { fetcher } = useWaclaw(sessionId);

  async function handleReact(msg: Message, emoji: string) {
    const senderJid = msg.senderJid || (msg.fromMe ? msg.chatJid : msg.chatJid);
    const result = await fetcher("react", {
      method: "POST",
      body: JSON.stringify({
        chatJid: msg.chatJid,
        msgId: msg.id,
        senderJid,
        fromMe: msg.fromMe,
        emoji,
      }),
    });
    if (!result?.ok) {
      throw new Error(result?.error || "Falha ao reagir");
    }
  }

  async function handleDelete(msg: Message) {
    const senderJid = msg.senderJid || msg.chatJid;
    const result = await fetcher("delete", {
      method: "POST",
      body: JSON.stringify({
        chatJid: msg.chatJid,
        msgId: msg.id,
        senderJid,
        fromMe: msg.fromMe,
      }),
    });
    if (!result?.ok) {
      throw new Error(result?.error || "Falha ao excluir");
    }
  }

  async function handleForwardSend(chatJid: string, msg: Message) {
    if (!chatJid) return;

    // Media forward: refetch bytes from the authenticated proxy URL, encode
    // as base64, and post to send-file on the target chat. The mediaUrl
    // already carries the user's access token and hits our Next proxy which
    // falls through to waclaw's /sessions/:id/media/:jid/:msgId endpoint,
    // so waclaw will lazy-download from WhatsApp on-demand if the file isn't
    // yet cached locally. Caption and filename are preserved.
    if (msg.mediaUrl) {
      const res = await fetch(msg.mediaUrl);
      if (!res.ok) throw new Error(`Falha ao buscar mídia: HTTP ${res.status}`);
      const blob = await res.blob();
      const dataBase64 = await blobToBase64(blob);
      const mime = msg.mimeType?.split(";")[0].trim() || blob.type || "application/octet-stream";
      const filename =
        msg.filename ||
        inferFilename(mime, msg.id);
      const result = await fetcher("send-file", {
        method: "POST",
        body: JSON.stringify({
          to: chatJid,
          filename,
          mimeType: mime,
          caption: msg.mediaCaption || undefined,
          dataBase64,
        }),
      });
      if (!result || result.error || result.ok === false) {
        throw new Error(result?.error || "Falha ao encaminhar mídia");
      }
      return;
    }

    // Text-only forward
    const text = (msg.text || "").trim();
    if (!text) throw new Error("Mensagem vazia");
    const result = await fetcher("send", {
      method: "POST",
      body: JSON.stringify({ to: chatJid, message: text }),
    });
    if (!result || result.error) {
      throw new Error(result?.error || "Falha ao encaminhar texto");
    }
  }
  const {
    messages, loading: msgsLoading, loadingOlder, hasOlder, sending,
    loadMessages, loadOlder, sendMessage, sendFile, toggleStar,
    replyTarget, setReplyTarget, initialLoad,
  } = useMessages(sessionId, selectedChat?.jid || null);

  // Reset selection when switching instances
  useEffect(() => {
    setSelectedChat(null);
    setReplyTarget(null);
  }, [activeInstanceId]);

  // Load messages when chat changes
  useEffect(() => {
    if (selectedChat) loadMessages();
  }, [selectedChat?.jid]);

  function handleSelectChat(chat: Chat) {
    setSelectedChat(chat);
    setReplyTarget(null);
    markAsRead(chat.jid);
  }

  // First-run experience: user has no instances yet — show QR wizard full-screen
  if (!instLoading && instances.length === 0) {
    return (
      <div
        style={{
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#f5f5f5",
        }}
      >
        <div>
          <h1 style={{ textAlign: "center", marginBottom: "1rem" }}>
            Bem-vindo ao zapi-pwa
          </h1>
          <p
            style={{
              textAlign: "center",
              color: "#666",
              marginBottom: "2rem",
            }}
          >
            Vamos conectar seu primeiro WhatsApp
          </p>
          <QRConnectWizard onDoneAction={() => reload()} />
        </div>
      </div>
    );
  }

  return (
    <div className={`wa-app ${selectedChat ? "chat-open" : ""}`}>
      <Sidebar
        instances={instances}
        instancesLoading={instLoading}
        activeInstanceId={activeInstanceId}
        onSelectInstance={setActiveInstanceId}
        onOpenSettings={() => setSettingsOpen(true)}
        chats={chats}
        loading={chatsLoading}
        search={search}
        onSearchChange={setSearch}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        tabCounts={tabCounts}
        selectedJid={selectedChat?.jid || null}
        onSelectChat={handleSelectChat}
        userEmail={session?.user?.email || ""}
        onSignOut={() => { signOut(); window.location.href = "/login"; }}
      />
      <div className="wa-main">
        {!selectedChat ? (
          <EmptyState />
        ) : (
          <ChatPanel
            chat={selectedChat}
            messages={messages}
            loading={msgsLoading}
            loadingOlder={loadingOlder}
            hasOlder={hasOlder}
            sending={sending}
            replyTarget={replyTarget}
            onLoadOlder={loadOlder}
            onSend={sendMessage}
            onSendFile={sendFile}
            onReply={setReplyTarget}
            onForward={setForwardTarget}
            onReact={handleReact}
            onToggleStar={toggleStar}
            onDelete={handleDelete}
            onCancelReply={() => setReplyTarget(null)}
            onBack={() => setSelectedChat(null)}
            onOpenSummary={() => setSummaryOpen(true)}
            onOpenSchedule={() => setScheduleOpen(true)}
            initialLoad={initialLoad}
          />
        )}
      </div>

      <SettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        instances={instances}
        activeInstanceId={activeInstanceId}
        onCreate={createWaclaw}
        onDelete={remove}
        onRename={rename}
        onReload={reload}
      />

      <ForwardPickerModal
        open={!!forwardTarget}
        onClose={() => setForwardTarget(null)}
        message={forwardTarget}
        chats={chats}
        onSend={handleForwardSend}
      />

      <SummaryModal
        open={summaryOpen}
        onClose={() => setSummaryOpen(false)}
        sessionId={sessionId}
        chatJid={selectedChat?.jid || null}
        chatName={selectedChat?.name || ""}
      />

      <ScheduleMessageModal
        open={scheduleOpen}
        onClose={() => setScheduleOpen(false)}
        sessionId={sessionId}
        chatJid={selectedChat?.jid || null}
        chatName={selectedChat?.name || ""}
      />
    </div>
  );
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(reader.error || new Error("File read failed"));
    reader.readAsDataURL(blob);
  });
}

function inferFilename(mime: string, msgId: string): string {
  const ext =
    mime.startsWith("image/jpeg") ? "jpg" :
    mime.startsWith("image/png") ? "png" :
    mime.startsWith("image/webp") ? "webp" :
    mime.startsWith("image/") ? "img" :
    mime.startsWith("video/mp4") ? "mp4" :
    mime.startsWith("video/webm") ? "webm" :
    mime.startsWith("video/") ? "vid" :
    mime.startsWith("audio/ogg") ? "ogg" :
    mime.startsWith("audio/mpeg") ? "mp3" :
    mime.startsWith("audio/mp4") ? "m4a" :
    mime.startsWith("audio/") ? "oga" :
    mime.includes("pdf") ? "pdf" :
    "bin";
  return `fwd-${msgId.slice(0, 12)}.${ext}`;
}
