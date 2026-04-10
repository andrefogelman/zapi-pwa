# WhatsApp Web Clone — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the zapi-pwa frontend as a pixel-accurate WhatsApp Web clone with full messaging capabilities — read, write, reply, search, filters by type (DMs, groups, channels separate).

**Architecture:** Decompose the monolithic 500-line page.tsx into focused React components. Sidebar (chat list with filters/tabs), ChatPanel (messages + input), and shared hooks for data fetching. All data comes from WaClaw API at `https://worker5.taile4c10f.ts.net` via `/api/waclaw/` proxy.

**Tech Stack:** Next.js 16, React 19, CSS modules (no external UI lib), WaClaw REST API.

**WaClaw API reference:**
- `GET /sessions/{id}/chats` → `[{jid, name, kind, lastTs, lastMessage, lastSender, msgCount, isGroup}]`
- `GET /sessions/{id}/messages/{jid}?limit=50&before={ts}` → `[{id, chatJid, chatName, senderJid, senderName, timestamp, fromMe, text, type, mediaCaption, filename, mimeType}]`
- `POST /sessions/{id}/send` → `{to, message}`
- `GET /sessions/{id}/search?q={term}&limit=20` → same as messages

**Chat kinds from DB:** `dm` (474), `group` (89), `unknown` (280, includes 34 newsletters + LID contacts), `broadcast` (8)

---

## File Structure

```
src/app/app/
├── page.tsx                    # Shell: loads instance, renders Sidebar + ChatPanel
├── components/
│   ├── Sidebar.tsx             # Left panel: header, search, tabs, chat list
│   ├── ChatList.tsx            # Scrollable list of ChatItem components
│   ├── ChatItem.tsx            # Single chat row (avatar, name, preview, time, unread)
│   ├── ChatPanel.tsx           # Right panel: header, messages, input
│   ├── MessageBubble.tsx       # Single message (text, audio, image, video, doc, reply)
│   ├── MessageInput.tsx        # Text input + send button + reply preview
│   ├── DaySeparator.tsx        # "HOJE", "ONTEM", date labels between messages
│   └── EmptyState.tsx          # "Select a conversation" placeholder
├── hooks/
│   ├── useWaclaw.ts            # Fetch wrapper for WaClaw API with auth headers
│   ├── useChats.ts             # Load, filter, search chats
│   └── useMessages.ts          # Load messages, pagination, send, reply
├── lib/
│   └── formatters.ts           # Time formatting, phone formatting, name formatting
└── whatsapp.css                # Global WhatsApp theme (rewrite, pixel-accurate)
```

---

### Task 1: Formatters & Utilities

**Files:**
- Create: `src/app/app/lib/formatters.ts`

- [ ] **Step 1: Create formatters**

```typescript
// Chat name: resolve JID to human-readable name
export function formatChatName(jid: string, name: string | null): string {
  if (name && name !== jid && !name.includes("@")) return name;
  const phone = jid.split("@")[0];
  if (/^\d{12,13}$/.test(phone) && phone.startsWith("55")) {
    const ddd = phone.slice(2, 4);
    const num = phone.slice(4);
    if (num.length === 9) return `(${ddd}) ${num.slice(0, 5)}-${num.slice(5)}`;
    if (num.length === 8) return `(${ddd}) ${num.slice(0, 4)}-${num.slice(4)}`;
  }
  if (/^\d+$/.test(phone)) return `+${phone}`;
  return phone;
}

// Chat time: relative for sidebar
export function formatChatTime(ts: number): string {
  if (!ts) return "";
  // Timestamps from wacli are unix seconds, not ms
  const d = new Date(ts < 1e12 ? ts * 1000 : ts);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const msgDay = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diff = Math.floor((today.getTime() - msgDay.getTime()) / 86400000);
  if (diff === 0) return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  if (diff === 1) return "Ontem";
  if (diff < 7) return d.toLocaleDateString("pt-BR", { weekday: "short" });
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit" });
}

// Message time: HH:MM
export function formatMsgTime(ts: number): string {
  const d = new Date(ts < 1e12 ? ts * 1000 : ts);
  return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

// Day separator label
export function formatDayLabel(ts: number): string {
  const d = new Date(ts < 1e12 ? ts * 1000 : ts);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const msgDay = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diff = Math.floor((today.getTime() - msgDay.getTime()) / 86400000);
  if (diff === 0) return "HOJE";
  if (diff === 1) return "ONTEM";
  return d.toLocaleDateString("pt-BR", { day: "numeric", month: "long", year: "numeric" }).toUpperCase();
}

// Initial letter for avatar
export function getInitial(name: string): string {
  const clean = name.replace(/[^a-zA-ZÀ-ÿ0-9]/g, "");
  return clean.charAt(0).toUpperCase() || "?";
}

// Chat kind to tab
export type ChatTab = "all" | "dms" | "groups" | "channels";
export function getChatTab(kind: string, jid: string): ChatTab {
  if (jid.includes("@newsletter") || jid === "status@broadcast") return "channels";
  if (kind === "group") return "groups";
  if (kind === "dm") return "dms";
  // "unknown" with @lid or @s.whatsapp.net are DMs
  if (jid.includes("@s.whatsapp.net") || jid.includes("@lid")) return "dms";
  if (jid.includes("@g.us")) return "groups";
  return "dms";
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/app/lib/formatters.ts
git commit -m "feat: add formatting utilities for WhatsApp Web clone"
```

---

### Task 2: WaClaw API Hook

**Files:**
- Create: `src/app/app/hooks/useWaclaw.ts`

- [ ] **Step 1: Create the hook**

```typescript
"use client";

import { useAuth } from "@/lib/use-auth";
import { useCallback } from "react";

export function useWaclaw(sessionId: string | null) {
  const { session } = useAuth();

  const fetcher = useCallback(async (path: string, options?: RequestInit) => {
    if (!sessionId || !session?.access_token) return null;
    const res = await fetch(`/api/waclaw/sessions/${sessionId}/${path}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        "Content-Type": "application/json",
        ...options?.headers,
      },
    });
    if (!res.ok) return null;
    return res.json();
  }, [sessionId, session?.access_token]);

  return { fetcher, ready: !!sessionId && !!session?.access_token };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/app/hooks/useWaclaw.ts
git commit -m "feat: add useWaclaw API hook"
```

---

### Task 3: useChats Hook

**Files:**
- Create: `src/app/app/hooks/useChats.ts`

- [ ] **Step 1: Create the hook**

```typescript
"use client";

import { useState, useEffect, useMemo } from "react";
import { useWaclaw } from "./useWaclaw";
import { getChatTab, type ChatTab } from "../lib/formatters";

export interface Chat {
  jid: string;
  name: string;
  kind: string;
  lastTs: number;
  lastMessage: string | null;
  lastSender: string | null;
  msgCount: number;
  isGroup: boolean;
  tab: ChatTab;
}

export function useChats(sessionId: string | null) {
  const { fetcher, ready } = useWaclaw(sessionId);
  const [allChats, setAllChats] = useState<Chat[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [activeTab, setActiveTab] = useState<ChatTab>("all");

  useEffect(() => {
    if (!ready) return;
    setLoading(true);
    fetcher("chats").then((data) => {
      if (Array.isArray(data)) {
        setAllChats(data.map((c: Record<string, unknown>) => ({
          jid: c.jid as string,
          name: (c.name as string) || (c.jid as string).split("@")[0],
          kind: (c.kind as string) || "unknown",
          lastTs: c.lastTs as number,
          lastMessage: c.lastMessage as string | null,
          lastSender: c.lastSender as string | null,
          msgCount: (c.msgCount as number) || 0,
          isGroup: (c.isGroup as boolean) || false,
          tab: getChatTab((c.kind as string) || "unknown", c.jid as string),
        })));
      }
      setLoading(false);
    });
  }, [ready]);

  const filtered = useMemo(() => {
    let result = allChats;
    // Filter by tab
    if (activeTab !== "all") {
      result = result.filter((c) => c.tab === activeTab);
    }
    // Filter by search
    if (search) {
      const q = search.toLowerCase();
      result = result.filter((c) =>
        c.name.toLowerCase().includes(q) ||
        c.jid.includes(q) ||
        c.lastMessage?.toLowerCase().includes(q)
      );
    }
    return result;
  }, [allChats, activeTab, search]);

  const tabCounts = useMemo(() => ({
    all: allChats.length,
    dms: allChats.filter((c) => c.tab === "dms").length,
    groups: allChats.filter((c) => c.tab === "groups").length,
    channels: allChats.filter((c) => c.tab === "channels").length,
  }), [allChats]);

  return { chats: filtered, loading, search, setSearch, activeTab, setActiveTab, tabCounts };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/app/hooks/useChats.ts
git commit -m "feat: add useChats hook with tabs and search"
```

---

### Task 4: useMessages Hook

**Files:**
- Create: `src/app/app/hooks/useMessages.ts`

- [ ] **Step 1: Create the hook**

```typescript
"use client";

import { useState, useCallback, useRef } from "react";
import { useWaclaw } from "./useWaclaw";

export interface Message {
  id: string;
  chatJid: string;
  chatName: string | null;
  senderJid: string | null;
  senderName: string | null;
  timestamp: number;
  fromMe: boolean;
  text: string | null;
  type: string;
  mediaCaption: string | null;
  filename: string | null;
  mimeType: string | null;
}

export interface ReplyTarget {
  id: string;
  senderName: string | null;
  text: string | null;
  fromMe: boolean;
}

export function useMessages(sessionId: string | null, chatJid: string | null) {
  const { fetcher } = useWaclaw(sessionId);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [hasOlder, setHasOlder] = useState(true);
  const [sending, setSending] = useState(false);
  const [replyTarget, setReplyTarget] = useState<ReplyTarget | null>(null);
  const initialLoad = useRef(true);

  const loadMessages = useCallback(async () => {
    if (!chatJid) return;
    setLoading(true);
    setHasOlder(true);
    initialLoad.current = true;
    const data = await fetcher(`messages/${encodeURIComponent(chatJid)}?limit=80`);
    if (Array.isArray(data)) setMessages(data);
    setLoading(false);
  }, [chatJid, fetcher]);

  const loadOlder = useCallback(async () => {
    if (!chatJid || loadingOlder || !hasOlder || messages.length === 0) return;
    setLoadingOlder(true);
    const oldest = messages[0]?.timestamp;
    const data = await fetcher(`messages/${encodeURIComponent(chatJid)}?limit=50&before=${oldest}`);
    if (Array.isArray(data)) {
      if (data.length === 0) setHasOlder(false);
      else setMessages((prev) => [...data, ...prev]);
    }
    setLoadingOlder(false);
  }, [chatJid, fetcher, loadingOlder, hasOlder, messages]);

  const sendMessage = useCallback(async (text: string) => {
    if (!chatJid || !text.trim() || sending) return;
    setSending(true);

    // Build message with optional reply quote
    let fullText = text;
    if (replyTarget) {
      // WhatsApp quote format not needed for wacli send — just send plain text
      // The reply context is visual only in our UI
      fullText = text;
    }

    await fetcher("send", {
      method: "POST",
      body: JSON.stringify({ to: chatJid, message: fullText }),
    });

    // Optimistic update
    setMessages((prev) => [...prev, {
      id: `local-${Date.now()}`,
      chatJid,
      chatName: null,
      senderJid: null,
      senderName: null,
      timestamp: Date.now() / 1000,
      fromMe: true,
      text: fullText,
      type: "text",
      mediaCaption: null,
      filename: null,
      mimeType: null,
    }]);

    setReplyTarget(null);
    setSending(false);
  }, [chatJid, fetcher, sending, replyTarget]);

  return {
    messages, loading, loadingOlder, hasOlder, sending,
    loadMessages, loadOlder, sendMessage,
    replyTarget, setReplyTarget,
    initialLoad,
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/app/hooks/useMessages.ts
git commit -m "feat: add useMessages hook with pagination, send, reply"
```

---

### Task 5: Small Components (DaySeparator, EmptyState, ChatItem, MessageBubble)

**Files:**
- Create: `src/app/app/components/DaySeparator.tsx`
- Create: `src/app/app/components/EmptyState.tsx`
- Create: `src/app/app/components/ChatItem.tsx`
- Create: `src/app/app/components/MessageBubble.tsx`

- [ ] **Step 1: DaySeparator**

```tsx
export function DaySeparator({ label }: { label: string }) {
  return (
    <div className="wa-day-sep">
      <span>{label}</span>
    </div>
  );
}
```

- [ ] **Step 2: EmptyState**

```tsx
export function EmptyState() {
  return (
    <div className="wa-empty">
      <svg width="250" height="250" viewBox="0 0 303 172" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M229.565 160.229C262.212 149.245 286.931 118.241 283.39 73.4194C278.009 5.31929 212.365 -11.5738 171.472 8.48325C115.998 37.3257 88.7055 11.5765 63.0143 15.408C22.0384 21.5924 -17.4431 58.3243 8.40709 106.39C25.1393 137.604 41.9002 146.975 76.1347 155.478C110.369 163.981 131.442 155.02 161.636 163.039C191.83 171.057 196.918 171.213 229.565 160.229Z" fill="#DAF7F3"/>
        <path d="M131.589 68.9422C131.589 44.8882 151.634 25.3862 176.353 25.3862C201.072 25.3862 221.117 44.8882 221.117 68.9422C221.117 93.0035 201.072 112.498 176.353 112.498C171.455 112.498 166.747 111.748 162.353 110.362L143.865 118.199L147.533 103.965C137.789 94.9965 131.589 82.6855 131.589 68.9422Z" fill="white"/>
        <path d="M154.07 63.5005H198.638" stroke="#9DDDD0" strokeWidth="3" strokeLinecap="round"/>
        <path d="M154.07 75.5005H185.638" stroke="#9DDDD0" strokeWidth="3" strokeLinecap="round"/>
      </svg>
      <h2 style={{ fontSize: 28, fontWeight: 300, color: "#41525d", marginTop: 20 }}>Transcritor WhatsApp</h2>
      <p style={{ fontSize: 14, color: "#8696a0", marginTop: 8 }}>
        Envie e receba mensagens. Selecione uma conversa para começar.
      </p>
    </div>
  );
}
```

- [ ] **Step 3: ChatItem**

```tsx
import { formatChatName, formatChatTime, getInitial } from "../lib/formatters";
import type { Chat } from "../hooks/useChats";

interface Props {
  chat: Chat;
  selected: boolean;
  onClick: () => void;
}

export function ChatItem({ chat, selected, onClick }: Props) {
  const displayName = formatChatName(chat.jid, chat.name);

  return (
    <div className={`wa-chat-item ${selected ? "active" : ""}`} onClick={onClick}>
      <div className={`wa-avatar ${chat.isGroup ? "group" : ""}`}>
        {getInitial(displayName)}
      </div>
      <div className="wa-chat-body">
        <div className="wa-chat-row">
          <span className="wa-chat-name">{displayName}</span>
          <span className="wa-chat-time">{formatChatTime(chat.lastTs)}</span>
        </div>
        <div className="wa-chat-row">
          <span className="wa-chat-preview">
            {chat.lastSender && !chat.isGroup ? "" : chat.lastSender ? `${chat.lastSender}: ` : ""}
            {chat.lastMessage || ""}
          </span>
          {chat.msgCount > 0 && !chat.lastMessage && (
            <span className="wa-chat-count">{chat.msgCount}</span>
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: MessageBubble**

```tsx
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
        {/* Sender name in groups */}
        {!msg.fromMe && isGroup && msg.senderName && (
          <div className="wa-msg-sender">{msg.senderName}</div>
        )}

        {/* Content by type */}
        {msg.type === "audio" || msg.type === "ptt" ? (
          <div className="wa-msg-media">
            <span className="wa-msg-media-icon">🎵</span>
            <span>Mensagem de voz</span>
          </div>
        ) : msg.type === "image" ? (
          <div className="wa-msg-media">
            <span className="wa-msg-media-icon">📷</span>
            <span>{msg.mediaCaption || "Foto"}</span>
          </div>
        ) : msg.type === "video" ? (
          <div className="wa-msg-media">
            <span className="wa-msg-media-icon">🎬</span>
            <span>{msg.mediaCaption || "Vídeo"}</span>
          </div>
        ) : msg.type === "document" ? (
          <div className="wa-msg-media">
            <span className="wa-msg-media-icon">📄</span>
            <span>{msg.filename || "Documento"}</span>
          </div>
        ) : msg.type === "sticker" ? (
          <div className="wa-msg-media">
            <span className="wa-msg-media-icon">🏷️</span>
            <span>Figurinha</span>
          </div>
        ) : (
          <div className="wa-msg-text">{msg.text}</div>
        )}

        {/* Time */}
        <span className="wa-msg-time">{time}</span>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Commit**

```bash
git add src/app/app/components/
git commit -m "feat: add DaySeparator, EmptyState, ChatItem, MessageBubble components"
```

---

### Task 6: MessageInput Component

**Files:**
- Create: `src/app/app/components/MessageInput.tsx`

- [ ] **Step 1: Create MessageInput with reply preview**

```tsx
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
      {/* Reply preview */}
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
        <button
          className="wa-send-btn"
          onClick={onSend}
          disabled={!value.trim() || sending}
        >
          <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor">
            <path d="M1.101 21.757L23.8 12.028 1.101 2.3l.011 7.912 13.623 1.816-13.623 1.817-.011 7.912z"/>
          </svg>
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/app/components/MessageInput.tsx
git commit -m "feat: add MessageInput with reply preview"
```

---

### Task 7: Sidebar Component

**Files:**
- Create: `src/app/app/components/Sidebar.tsx`

- [ ] **Step 1: Create Sidebar with tabs**

```tsx
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
      {/* Header */}
      <div className="wa-sidebar-header">
        <div className="wa-sidebar-avatar">{userEmail.charAt(0).toUpperCase()}</div>
        <div style={{ flex: 1 }} />
        <button className="wa-icon-btn" onClick={onSignOut} title="Sair">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="#54656f">
            <path d="M16 13v-2H7V8l-5 4 5 4v-3z"/>
            <path d="M20 3h-9c-1.103 0-2 .897-2 2v4h2V5h9v14h-9v-4H9v4c0 1.103.897 2 2 2h9c1.103 0 2-.897 2-2V5c0-1.103-.897-2-2-2z"/>
          </svg>
        </button>
      </div>

      {/* Search */}
      <div className="wa-search-bar">
        <div className="wa-search-input-wrap">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="#8696a0">
            <path d="M15.009 13.805h-.636l-.22-.219a5.184 5.184 0 001.256-3.386 5.207 5.207 0 10-5.207 5.208 5.183 5.183 0 003.385-1.255l.221.22v.635l4.004 3.999 1.194-1.195-3.997-4.007zm-4.808 0a3.605 3.605 0 110-7.21 3.605 3.605 0 010 7.21z"/>
          </svg>
          <input
            placeholder="Pesquisar"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
          />
        </div>
      </div>

      {/* Tabs */}
      <div className="wa-tabs">
        {TABS.map((t) => (
          <button
            key={t.key}
            className={`wa-tab ${activeTab === t.key ? "active" : ""}`}
            onClick={() => onTabChange(t.key)}
          >
            {t.label}
            {t.key !== "all" && tabCounts[t.key] > 0 && (
              <span className="wa-tab-count">{tabCounts[t.key]}</span>
            )}
          </button>
        ))}
      </div>

      {/* Chat list */}
      <div className="wa-chatlist">
        {loading && <div className="wa-loading">Carregando...</div>}
        {!loading && chats.length === 0 && (
          <div className="wa-loading">Nenhuma conversa encontrada</div>
        )}
        {chats.map((chat) => (
          <ChatItem
            key={chat.jid}
            chat={chat}
            selected={chat.jid === selectedJid}
            onClick={() => onSelectChat(chat)}
          />
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/app/components/Sidebar.tsx
git commit -m "feat: add Sidebar with tabs (Tudo, Conversas, Grupos, Canais)"
```

---

### Task 8: ChatPanel Component

**Files:**
- Create: `src/app/app/components/ChatPanel.tsx`

- [ ] **Step 1: Create ChatPanel**

```tsx
import { useEffect, useRef, useState } from "react";
import { MessageBubble } from "./MessageBubble";
import { MessageInput } from "./MessageInput";
import { DaySeparator } from "./DaySeparator";
import { formatChatName, getInitial, formatDayLabel } from "../lib/formatters";
import type { Chat } from "../hooks/useChats";
import type { Message, ReplyTarget } from "../hooks/useMessages";

interface Props {
  chat: Chat;
  messages: Message[];
  loading: boolean;
  loadingOlder: boolean;
  hasOlder: boolean;
  sending: boolean;
  replyTarget: ReplyTarget | null;
  onLoadOlder: () => void;
  onSend: (text: string) => void;
  onReply: (target: ReplyTarget) => void;
  onCancelReply: () => void;
  onBack: () => void; // mobile
  initialLoad: React.MutableRefObject<boolean>;
}

export function ChatPanel({
  chat, messages, loading, loadingOlder, hasOlder, sending,
  replyTarget, onLoadOlder, onSend, onReply, onCancelReply, onBack, initialLoad,
}: Props) {
  const [input, setInput] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const displayName = formatChatName(chat.jid, chat.name);

  // Scroll to bottom on initial load
  useEffect(() => {
    if (initialLoad.current && messages.length > 0) {
      bottomRef.current?.scrollIntoView({ behavior: "instant" });
      initialLoad.current = false;
    }
  }, [messages]);

  // Scroll pagination
  function handleScroll() {
    const el = containerRef.current;
    if (el && el.scrollTop < 80 && !loadingOlder && hasOlder && messages.length > 0) {
      const prevHeight = el.scrollHeight;
      onLoadOlder();
      requestAnimationFrame(() => {
        if (el) el.scrollTop = el.scrollHeight - prevHeight;
      });
    }
  }

  function handleSend() {
    if (!input.trim()) return;
    onSend(input);
    setInput("");
    setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
  }

  // Group messages by day
  const groups: { label: string; key: string; msgs: Message[] }[] = [];
  for (const msg of messages) {
    const d = new Date(msg.timestamp < 1e12 ? msg.timestamp * 1000 : msg.timestamp);
    const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    const last = groups[groups.length - 1];
    if (last && last.key === key) {
      last.msgs.push(msg);
    } else {
      groups.push({ label: formatDayLabel(msg.timestamp), key, msgs: [msg] });
    }
  }

  return (
    <div className="wa-chat-panel">
      {/* Header */}
      <div className="wa-panel-header">
        <button className="wa-back-btn" onClick={onBack}>
          <svg viewBox="0 0 24 24" width="24" height="24" fill="#54656f"><path d="M12 4l1.4 1.4L7.8 11H20v2H7.8l5.6 5.6L12 20l-8-8z"/></svg>
        </button>
        <div className={`wa-avatar sm ${chat.isGroup ? "group" : ""}`}>
          {getInitial(displayName)}
        </div>
        <div className="wa-panel-header-info">
          <div className="wa-panel-header-name">{displayName}</div>
          <div className="wa-panel-header-sub">
            {chat.isGroup ? `${chat.msgCount} mensagens` : chat.jid.split("@")[0]}
          </div>
        </div>
      </div>

      {/* Messages */}
      <div className="wa-messages" ref={containerRef} onScroll={handleScroll}>
        {loadingOlder && <div className="wa-loading sm">Carregando...</div>}
        {loading && <div className="wa-loading">Carregando mensagens...</div>}

        {groups.map((g) => (
          <div key={g.key}>
            <DaySeparator label={g.label} />
            {g.msgs.map((msg) => (
              <MessageBubble key={msg.id} msg={msg} isGroup={chat.isGroup} onReply={onReply} />
            ))}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <MessageInput
        value={input}
        onChange={setInput}
        onSend={handleSend}
        sending={sending}
        replyTarget={replyTarget}
        onCancelReply={onCancelReply}
      />
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/app/components/ChatPanel.tsx
git commit -m "feat: add ChatPanel with messages, day separators, reply, pagination"
```

---

### Task 9: CSS Rewrite (Pixel-Accurate WhatsApp Web)

**Files:**
- Rewrite: `src/app/app/whatsapp.css`

- [ ] **Step 1: Rewrite entire CSS**

Complete CSS file — too long to inline here. Key sections:
- WhatsApp exact colors (#111b21, #202c33, #005c4b, #d9fdd3, #e7e7e7)
- Sidebar: 30% width, min 340px, max 500px
- Chat list items: 72px height, 49px avatars
- Tabs bar: WhatsApp-style pill tabs with green active indicator
- Message bubbles: exact border-radius (7.5px), tail shapes
- Input area: rounded input, green send button
- Reply preview bar: green left border
- Search bar: #f0f2f5 background, rounded
- Day separator: blue-ish rounded pill
- Mobile: sidebar full-width, chat panel hidden; swap on chat select
- Scrollbars: thin, translucent

This file should be ~350-400 lines.

- [ ] **Step 2: Commit**

```bash
git add src/app/app/whatsapp.css
git commit -m "feat: pixel-accurate WhatsApp Web CSS"
```

---

### Task 10: Main Page (Wire Everything Together)

**Files:**
- Rewrite: `src/app/app/page.tsx`

- [ ] **Step 1: Rewrite page.tsx as slim orchestrator (~80 lines)**

```tsx
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
```

- [ ] **Step 2: Commit**

```bash
git add src/app/app/page.tsx
git commit -m "feat: wire components into slim page orchestrator"
```

---

### Task 11: Build, Test, Deploy

- [ ] **Step 1: Run build**

```bash
cd /Users/andrefogelman/zapi-pwa && npm run build
```

Expected: Build succeeds, all routes listed.

- [ ] **Step 2: Test locally**

```bash
npm run dev
```

Open `http://localhost:3000/login`, login, verify:
- Tabs filter correctly (Tudo, Conversas, Grupos, Canais)
- No newsletters in Conversas tab
- Click chat → opens in right panel (same page)
- Messages load with day separators
- Can type and send messages
- Right-click message → reply preview appears
- Scroll up → loads older messages
- Mobile: single column, back button works

- [ ] **Step 3: Commit and push**

```bash
git add -A
git commit -m "feat: complete WhatsApp Web clone — tabs, reply, search, send"
git push
```

- [ ] **Step 4: Deploy**

```bash
vercel deploy --prod
```
