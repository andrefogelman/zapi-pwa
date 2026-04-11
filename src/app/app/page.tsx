"use client";

import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/lib/use-auth";
import { Sidebar } from "./components/Sidebar";
import { ChatPanel } from "./components/ChatPanel";
import { EmptyState } from "./components/EmptyState";
import { SettingsModal } from "./components/SettingsModal";
import { useChats, type Chat } from "./hooks/useChats";
import { useMessages } from "./hooks/useMessages";
import { useInstances } from "./hooks/useInstances";

export default function AppMain() {
  const { session, signOut } = useAuth();
  const { instances, loading: instLoading, reload, createWaclaw, remove, rename } = useInstances();
  const [activeInstanceId, setActiveInstanceId] = useState<string | null>(null);
  const [selectedChat, setSelectedChat] = useState<Chat | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

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

  const { chats, loading: chatsLoading, search, setSearch, activeTab, setActiveTab, tabCounts } = useChats(sessionId);
  const {
    messages, loading: msgsLoading, loadingOlder, hasOlder, sending,
    loadMessages, loadOlder, sendMessage, sendFile,
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
            onCancelReply={() => setReplyTarget(null)}
            onBack={() => setSelectedChat(null)}
            initialLoad={initialLoad}
          />
        )}
      </div>

      <SettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        instances={instances}
        onCreate={createWaclaw}
        onDelete={remove}
        onRename={rename}
        onReload={reload}
      />
    </div>
  );
}
