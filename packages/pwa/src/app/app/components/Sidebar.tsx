"use client";

import Link from "next/link";
import { ChatItem } from "./ChatItem";
import { InstanceTabs } from "./InstanceTabs";
import type { Chat } from "../hooks/useChats";
import type { Instance } from "../hooks/useInstances";
import type { ChatTab } from "../lib/formatters";
import { useUserSettings } from "../hooks/useUserSettings";

interface Props {
  instances: Instance[];
  instancesLoading: boolean;
  activeInstanceId: string | null;
  onSelectInstance: (id: string) => void;
  onOpenSettings: () => void;
  chats: Chat[];
  loading: boolean;
  search: string;
  onSearchChange: (v: string) => void;
  activeTab: ChatTab;
  onTabChange: (tab: ChatTab) => void;
  tabCounts: Record<ChatTab, number>;
  selectedJid: string | null;
  onSelectChat: (chat: Chat) => void;
  onChatContextMenu?: (chat: Chat, x: number, y: number) => void;
  userEmail: string;
  onSignOut: () => void;
  onOpenTasks: () => void;
  taskCount: number;
}

const TABS: { key: ChatTab; label: string }[] = [
  { key: "all", label: "Tudo" },
  { key: "dms", label: "Conversas" },
  { key: "groups", label: "Grupos" },
];

export function Sidebar({
  instances,
  instancesLoading,
  activeInstanceId,
  onSelectInstance,
  onOpenSettings,
  chats,
  loading,
  search,
  onSearchChange,
  activeTab,
  onTabChange,
  tabCounts,
  selectedJid,
  onSelectChat,
  onChatContextMenu,
  userEmail,
  onSignOut,
  onOpenTasks,
  taskCount,
}: Props) {
  const { settings } = useUserSettings();
  return (
    <div className="wa-sidebar">
      <div className="wa-sidebar-header">
        <div className="wa-sidebar-avatar">{userEmail.charAt(0).toUpperCase()}</div>
        <div style={{ flex: 1 }} />
        <button className="wa-icon-btn" onClick={onOpenTasks} title="Tarefas" style={{ position: "relative" }}>
          <svg viewBox="0 0 24 24" width="20" height="20" fill="#aebac1">
            <path d="M22 5.18L10.59 16.6l-4.24-4.24 1.41-1.41 2.83 2.83 10-10L22 5.18zM12 20c-4.41 0-8-3.59-8-8s3.59-8 8-8c1.57 0 3.04.46 4.28 1.25l1.45-1.45A10.02 10.02 0 0012 2C6.48 2 2 6.48 2 12s4.48 10 10 10c2.76 0 5.26-1.12 7.07-2.93l-1.42-1.42A7.94 7.94 0 0112 20z"/>
          </svg>
          {taskCount > 0 && (
            <span style={{
              position: "absolute", top: 0, right: 0,
              background: "#00a884", color: "#111b21",
              fontSize: 9, fontWeight: 700,
              minWidth: 16, height: 16, borderRadius: "50%",
              display: "flex", alignItems: "center", justifyContent: "center",
              padding: "0 3px",
            }}>
              {taskCount}
            </span>
          )}
        </button>
        <button className="wa-icon-btn" onClick={onSignOut} title="Sair">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="#aebac1">
            <path d="M16 13v-2H7V8l-5 4 5 4v-3z"/>
            <path d="M20 3h-9c-1.103 0-2 .897-2 2v4h2V5h9v14h-9v-4H9v4c0 1.103.897 2 2 2h9c1.103 0 2-.897 2-2V5c0-1.103-.897-2-2-2z"/>
          </svg>
        </button>
      </div>

      <InstanceTabs
        instances={instances}
        activeId={activeInstanceId}
        onSelect={onSelectInstance}
        onOpenSettings={onOpenSettings}
      />

      <div className="wa-search-bar">
        <div className="wa-search-input-wrap">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="#8696a0">
            <path d="M15.009 13.805h-.636l-.22-.219a5.184 5.184 0 001.256-3.386 5.207 5.207 0 10-5.207 5.208 5.183 5.183 0 003.385-1.255l.221.22v.635l4.004 3.999 1.194-1.195-3.997-4.007zm-4.808 0a3.605 3.605 0 110-7.21 3.605 3.605 0 010 7.21z"/>
          </svg>
          <input placeholder="Pesquisar" value={search} onChange={(e) => onSearchChange(e.target.value)} />
          {search && (
            <button
              type="button"
              onClick={() => onSearchChange("")}
              aria-label="Limpar busca"
              style={{
                background: "transparent",
                border: "none",
                color: "#8696a0",
                cursor: "pointer",
                padding: "0 4px",
                fontSize: 18,
                lineHeight: 1,
                display: "flex",
                alignItems: "center",
              }}
            >
              ×
            </button>
          )}
        </div>
      </div>

      <div className="wa-tabs">
        {TABS.map((t) => (
          <button key={t.key} className={`wa-tab ${activeTab === t.key ? "active" : ""}`} onClick={() => onTabChange(t.key)}>
            {t.label}
            {t.key !== "all" && tabCounts[t.key] > 0 && <span className="wa-tab-count">{tabCounts[t.key]}</span>}
          </button>
        ))}
      </div>

      <div className="wa-chatlist">
        {instancesLoading && <div className="wa-loading">Carregando instâncias...</div>}
        {!instancesLoading && instances.length === 0 && (
          <div className="wa-loading">
            Nenhuma instância.
            <br />
            <button
              className="wa-modal-primary"
              style={{ marginTop: 12 }}
              onClick={onOpenSettings}
            >
              + Adicionar instância
            </button>
          </div>
        )}
        {!instancesLoading && loading && <div className="wa-loading">Carregando conversas...</div>}
        {!loading && !instancesLoading && chats.length === 0 && instances.length > 0 && (
          <div className="wa-loading">Nenhuma conversa encontrada</div>
        )}
        {chats.map((chat) => (
          <ChatItem
            key={chat.jid}
            chat={chat}
            selected={chat.jid === selectedJid}
            onClick={() => onSelectChat(chat)}
            onContextMenu={onChatContextMenu}
          />
        ))}
      </div>

      {settings?.role === "super_admin" && (
        <Link
          href="/admin"
          title="Admin da plataforma"
          style={{
            display: "block",
            padding: "0.5rem 0.75rem",
            marginTop: "auto",
            color: "#1976d2",
            textDecoration: "none",
            fontSize: "0.9rem",
            borderTop: "1px solid #2a3942",
          }}
        >
          ⚙️ Admin
        </Link>
      )}
    </div>
  );
}
