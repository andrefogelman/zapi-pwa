import { ChatItem } from "./ChatItem";
import type { Chat } from "../hooks/useChats";
import type { ChatTab } from "../lib/formatters";

interface Props {
  chats: Chat[];
  loading: boolean;
  search: string;
  onSearchChange: (v: string) => void;
  activeTab: ChatTab;
  onTabChange: (tab: ChatTab) => void;
  tabCounts: Record<ChatTab, number>;
  selectedJid: string | null;
  onSelectChat: (chat: Chat) => void;
  userEmail: string;
  onSignOut: () => void;
}

const TABS: { key: ChatTab; label: string }[] = [
  { key: "all", label: "Tudo" },
  { key: "dms", label: "Conversas" },
  { key: "groups", label: "Grupos" },
  { key: "channels", label: "Canais" },
];

export function Sidebar({
  chats, loading, search, onSearchChange,
  activeTab, onTabChange, tabCounts,
  selectedJid, onSelectChat, userEmail, onSignOut,
}: Props) {
  return (
    <div className="wa-sidebar">
      <div className="wa-sidebar-header">
        <div className="wa-sidebar-avatar">{userEmail.charAt(0).toUpperCase()}</div>
        <div style={{ flex: 1 }} />
        <button className="wa-icon-btn" onClick={onSignOut} title="Sair">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="#aebac1">
            <path d="M16 13v-2H7V8l-5 4 5 4v-3z"/>
            <path d="M20 3h-9c-1.103 0-2 .897-2 2v4h2V5h9v14h-9v-4H9v4c0 1.103.897 2 2 2h9c1.103 0 2-.897 2-2V5c0-1.103-.897-2-2-2z"/>
          </svg>
        </button>
      </div>

      <div className="wa-search-bar">
        <div className="wa-search-input-wrap">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="#8696a0">
            <path d="M15.009 13.805h-.636l-.22-.219a5.184 5.184 0 001.256-3.386 5.207 5.207 0 10-5.207 5.208 5.183 5.183 0 003.385-1.255l.221.22v.635l4.004 3.999 1.194-1.195-3.997-4.007zm-4.808 0a3.605 3.605 0 110-7.21 3.605 3.605 0 010 7.21z"/>
          </svg>
          <input placeholder="Pesquisar" value={search} onChange={(e) => onSearchChange(e.target.value)} />
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
        {loading && <div className="wa-loading">Carregando...</div>}
        {!loading && chats.length === 0 && <div className="wa-loading">Nenhuma conversa encontrada</div>}
        {chats.map((chat) => (
          <ChatItem key={chat.jid} chat={chat} selected={chat.jid === selectedJid} onClick={() => onSelectChat(chat)} />
        ))}
      </div>
    </div>
  );
}
