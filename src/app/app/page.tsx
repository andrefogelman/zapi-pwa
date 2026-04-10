"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/lib/use-auth";
import { Sidebar } from "./components/Sidebar";
import { ChatPanel } from "./components/ChatPanel";
import { EmptyState } from "./components/EmptyState";
import { useChats, type Chat } from "./hooks/useChats";
import { useMessages } from "./hooks/useMessages";

export default function AppMain() {
  const { session, signOut } = useAuth();
  const [instance, setInstance] = useState<{ id: string; waclaw_session_id: string | null } | null>(null);
  const [selectedChat, setSelectedChat] = useState<Chat | null>(null);

  const sessionId = instance?.waclaw_session_id || null;
  const { chats, loading: chatsLoading, search, setSearch, activeTab, setActiveTab, tabCounts } = useChats(sessionId);
  const {
    messages, loading: msgsLoading, loadingOlder, hasOlder, sending,
    loadMessages, loadOlder, sendMessage,
    replyTarget, setReplyTarget, initialLoad,
  } = useMessages(sessionId, selectedChat?.jid || null);

  // Load instance on mount
  useEffect(() => {
    if (!session) return;
    fetch("/api/instances", {
      headers: { Authorization: `Bearer ${session.access_token}` },
    }).then((r) => r.json()).then((data: Record<string, unknown>[]) => {
      const waclaw = data.find((i) => i.provider === "waclaw" && i.waclaw_session_id);
      const first = data[0];
      setInstance((waclaw || first || null) as typeof instance);
    });
  }, [session]);

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
            onReply={setReplyTarget}
            onCancelReply={() => setReplyTarget(null)}
            onBack={() => setSelectedChat(null)}
            initialLoad={initialLoad}
          />
        )}
      </div>
    </div>
  );
}
