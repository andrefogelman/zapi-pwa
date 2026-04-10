# Plan 3: PWA Interface & Real-time UX

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the WhatsApp-mirror PWA: login page, chat UI with 3-column desktop / single-column mobile layout, Supabase Realtime for live updates, service worker for offline caching, and VAPID push notifications.

**Architecture:** Next.js App Router renders the shell. Supabase Realtime streams new messages/transcriptions. Service Worker caches static assets (CacheFirst) and chat data (NetworkFirst). Web Push via VAPID delivers transcription alerts.

**Tech Stack:** Next.js 16 App Router, Supabase Realtime, Web Push API (VAPID), Service Worker, CSS (no external UI lib).

**Depends on:** Plan 1 (auth, instances, schema), Plan 2 (transcriptions flowing into DB).

---

## File Structure

```
src/app/
├── login/page.tsx                      # Login with Google OAuth + email
├── app/
│   ├── layout.tsx                      # App shell layout (sidebar + main)
│   ├── page.tsx                        # Redirect to first instance or setup
│   ├── instances/
│   │   └── page.tsx                    # Instance list + add new + QR code flow
│   └── chat/
│       ├── page.tsx                    # Chat list sidebar (conversations)
│       └── [chatJid]/page.tsx          # Message thread + transcription view
src/lib/
├── use-realtime.ts                     # Hook: subscribe to Supabase Realtime
├── use-auth.ts                         # Hook: auth state + token helper
├── push.ts                             # VAPID push subscription helper
public/
├── sw.js                               # Service Worker
├── icon-192.png                        # PWA icon (placeholder)
├── icon-512.png                        # PWA icon (placeholder)
src/app/api/
├── push/
│   ├── subscribe/route.ts             # POST: save push subscription
│   └── send/route.ts                  # POST: send push notification (internal)
```

---

### Task 1: Auth Hook & Login Page

**Files:**
- Create: `src/lib/use-auth.ts`
- Create: `src/app/login/page.tsx`

- [ ] **Step 1: Create `src/lib/use-auth.ts`**

```typescript
"use client";

import { useEffect, useState } from "react";
import { getSupabaseBrowser } from "./supabase-browser";
import type { User, Session } from "@supabase/supabase-js";

export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const supabase = getSupabaseBrowser();

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      setUser(session?.user ?? null);
    });

    return () => subscription.unsubscribe();
  }, []);

  const signInWithGoogle = () =>
    supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });

  const signInWithEmail = (email: string, password: string) =>
    supabase.auth.signInWithPassword({ email, password });

  const signOut = () => supabase.auth.signOut();

  return { user, session, loading, signInWithGoogle, signInWithEmail, signOut };
}
```

- [ ] **Step 2: Create `src/app/login/page.tsx`**

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/use-auth";

export default function LoginPage() {
  const { signInWithGoogle, signInWithEmail } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  async function handleEmailLogin(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const { error } = await signInWithEmail(email, password);
    if (error) {
      setError(error.message);
    } else {
      router.push("/app");
    }
  }

  return (
    <main style={{
      display: "flex", alignItems: "center", justifyContent: "center",
      minHeight: "100vh", background: "#f0f2f5",
    }}>
      <div style={{
        background: "#fff", borderRadius: 8, padding: "2rem",
        width: 360, boxShadow: "0 2px 8px rgba(0,0,0,0.1)",
      }}>
        <h1 style={{ fontSize: "1.25rem", marginBottom: "1.5rem", textAlign: "center" }}>
          Transcritor WhatsApp
        </h1>

        <button
          onClick={signInWithGoogle}
          style={{
            width: "100%", padding: "0.75rem", marginBottom: "1rem",
            background: "#4285f4", color: "#fff", border: "none",
            borderRadius: 4, cursor: "pointer", fontSize: "0.95rem",
          }}
        >
          Entrar com Google
        </button>

        <div style={{ textAlign: "center", margin: "0.75rem 0", color: "#999", fontSize: "0.85rem" }}>
          ou
        </div>

        <form onSubmit={handleEmailLogin}>
          <input
            type="email" placeholder="Email" value={email}
            onChange={(e) => setEmail(e.target.value)} required
            style={{ display: "block", width: "100%", padding: "0.6rem", marginBottom: "0.5rem", boxSizing: "border-box" }}
          />
          <input
            type="password" placeholder="Senha" value={password}
            onChange={(e) => setPassword(e.target.value)} required
            style={{ display: "block", width: "100%", padding: "0.6rem", marginBottom: "0.75rem", boxSizing: "border-box" }}
          />
          <button type="submit" style={{
            width: "100%", padding: "0.75rem", background: "#075e54",
            color: "#fff", border: "none", borderRadius: 4, cursor: "pointer",
          }}>
            Entrar
          </button>
          {error && <p style={{ color: "red", fontSize: "0.85rem", marginTop: "0.5rem" }}>{error}</p>}
        </form>
      </div>
    </main>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/use-auth.ts src/app/login/page.tsx
git commit -m "feat: add auth hook and login page with Google OAuth + email"
```

---

### Task 2: App Shell Layout

**Files:**
- Create: `src/app/app/layout.tsx`
- Create: `src/app/app/page.tsx`

- [ ] **Step 1: Create `src/app/app/layout.tsx`**

```tsx
"use client";

import { useAuth } from "@/lib/use-auth";
import { useRouter } from "next/navigation";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, loading, signOut } = useAuth();
  const router = useRouter();

  if (loading) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh" }}>
        Carregando...
      </div>
    );
  }

  if (!user) {
    router.push("/login");
    return null;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh" }}>
      {/* Top bar */}
      <header style={{
        background: "#075e54", color: "#fff", padding: "0.5rem 1rem",
        display: "flex", justifyContent: "space-between", alignItems: "center",
      }}>
        <span style={{ fontWeight: 600 }}>Transcritor</span>
        <div style={{ display: "flex", gap: "1rem", alignItems: "center" }}>
          <a href="/app/instances" style={{ color: "#fff", textDecoration: "none", fontSize: "0.9rem" }}>
            Instâncias
          </a>
          <a href="/app/chat" style={{ color: "#fff", textDecoration: "none", fontSize: "0.9rem" }}>
            Conversas
          </a>
          <button
            onClick={() => { signOut(); router.push("/login"); }}
            style={{ background: "none", border: "1px solid rgba(255,255,255,0.3)", color: "#fff", padding: "0.3rem 0.75rem", borderRadius: 4, cursor: "pointer", fontSize: "0.85rem" }}
          >
            Sair
          </button>
        </div>
      </header>

      {/* Content */}
      <main style={{ flex: 1, overflow: "auto" }}>
        {children}
      </main>
    </div>
  );
}
```

- [ ] **Step 2: Create `src/app/app/page.tsx`**

```tsx
import { redirect } from "next/navigation";

export default function AppHome() {
  redirect("/app/instances");
}
```

- [ ] **Step 3: Commit**

```bash
git add src/app/app/layout.tsx src/app/app/page.tsx
git commit -m "feat: add app shell layout with navigation header"
```

---

### Task 3: Instance Management Page

**Files:**
- Create: `src/app/app/instances/page.tsx`

- [ ] **Step 1: Create `src/app/app/instances/page.tsx`**

```tsx
"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/lib/use-auth";

interface Instance {
  id: string;
  name: string;
  zapi_instance_id: string;
  status: string;
  connected_phone: string | null;
}

export default function InstancesPage() {
  const { session } = useAuth();
  const [instances, setInstances] = useState<Instance[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: "", zapi_instance_id: "", zapi_token: "", zapi_client_token: "" });
  const [qrData, setQrData] = useState<{ instanceId: string; qr: string } | null>(null);
  const [msg, setMsg] = useState("");

  const headers = { Authorization: `Bearer ${session?.access_token}`, "Content-Type": "application/json" };

  useEffect(() => {
    if (session) loadInstances();
  }, [session]);

  async function loadInstances() {
    const res = await fetch("/api/instances", { headers });
    if (res.ok) setInstances(await res.json());
  }

  async function createInstance(e: React.FormEvent) {
    e.preventDefault();
    const res = await fetch("/api/instances", {
      method: "POST", headers,
      body: JSON.stringify(form),
    });
    if (res.ok) {
      setShowForm(false);
      setForm({ name: "", zapi_instance_id: "", zapi_token: "", zapi_client_token: "" });
      loadInstances();
    } else {
      setMsg((await res.json()).error);
    }
  }

  async function connectInstance(instanceId: string) {
    setMsg("Gerando QR Code...");
    const res = await fetch("/api/instances/qr", {
      method: "POST", headers,
      body: JSON.stringify({ instance_id: instanceId }),
    });
    if (res.ok) {
      const data = await res.json();
      setQrData({ instanceId, qr: data.value || data.qrcode });
      setMsg("Escaneie o QR Code no WhatsApp");
      pollStatus(instanceId);
    } else {
      setMsg("Erro ao gerar QR");
    }
  }

  async function pollStatus(instanceId: string) {
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 3000));
      const res = await fetch(`/api/instances/qr?instance_id=${instanceId}`, { headers });
      if (res.ok) {
        const data = await res.json();
        if (data.connected) {
          setQrData(null);
          setMsg("Conectado!");
          loadInstances();
          return;
        }
      }
    }
    setMsg("Timeout - tente novamente");
    setQrData(null);
  }

  const inputStyle = { display: "block" as const, width: "100%", padding: "0.5rem", marginBottom: "0.5rem", boxSizing: "border-box" as const };

  return (
    <div style={{ maxWidth: 600, margin: "1.5rem auto", padding: "0 1rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
        <h2 style={{ margin: 0 }}>Instâncias WhatsApp</h2>
        <button onClick={() => setShowForm(!showForm)} style={{ padding: "0.5rem 1rem", background: "#075e54", color: "#fff", border: "none", borderRadius: 4, cursor: "pointer" }}>
          + Nova
        </button>
      </div>

      {showForm && (
        <form onSubmit={createInstance} style={{ border: "1px solid #ddd", borderRadius: 4, padding: "1rem", marginBottom: "1rem" }}>
          <input placeholder="Nome" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} style={inputStyle} />
          <input placeholder="Z-API Instance ID" value={form.zapi_instance_id} onChange={(e) => setForm({ ...form, zapi_instance_id: e.target.value })} required style={inputStyle} />
          <input placeholder="Z-API Token" value={form.zapi_token} onChange={(e) => setForm({ ...form, zapi_token: e.target.value })} required style={inputStyle} />
          <input placeholder="Client Token (opcional)" value={form.zapi_client_token} onChange={(e) => setForm({ ...form, zapi_client_token: e.target.value })} style={inputStyle} />
          <button type="submit" style={{ padding: "0.5rem 1rem", background: "#075e54", color: "#fff", border: "none", borderRadius: 4, cursor: "pointer" }}>
            Criar
          </button>
        </form>
      )}

      {msg && <p style={{ padding: "0.5rem", background: "#f5f5f5", borderRadius: 4 }}>{msg}</p>}

      {qrData && (
        <div style={{ textAlign: "center", padding: "1rem", border: "1px solid #ddd", borderRadius: 4, marginBottom: "1rem" }}>
          <img src={`data:image/png;base64,${qrData.qr}`} alt="QR Code" style={{ maxWidth: 256 }} />
          <p style={{ fontSize: "0.85rem", color: "#666" }}>Escaneie com o WhatsApp</p>
        </div>
      )}

      {instances.length === 0 && !showForm && (
        <p style={{ color: "#999", textAlign: "center", padding: "2rem" }}>Nenhuma instância. Clique em "+ Nova" para começar.</p>
      )}

      {instances.map((inst) => (
        <div key={inst.id} style={{
          border: "1px solid #ddd", borderRadius: 4, padding: "0.75rem 1rem",
          marginBottom: "0.5rem", display: "flex", justifyContent: "space-between", alignItems: "center",
        }}>
          <div>
            <strong>{inst.name}</strong>
            <div style={{ fontSize: "0.8rem", color: "#666" }}>
              {inst.connected_phone || inst.zapi_instance_id}
            </div>
          </div>
          <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
            <span style={{
              fontSize: "0.75rem", padding: "0.2rem 0.5rem", borderRadius: 12,
              background: inst.status === "connected" ? "#dcf8c6" : "#fdd",
              color: inst.status === "connected" ? "#075e54" : "#c00",
            }}>
              {inst.status}
            </span>
            {inst.status !== "connected" && (
              <button onClick={() => connectInstance(inst.id)} style={{
                padding: "0.3rem 0.75rem", background: "#25d366", color: "#fff",
                border: "none", borderRadius: 4, cursor: "pointer", fontSize: "0.85rem",
              }}>
                Conectar
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/app/instances/page.tsx
git commit -m "feat: add instance management page with QR code flow"
```

---

### Task 4: Realtime Hook

**Files:**
- Create: `src/lib/use-realtime.ts`

- [ ] **Step 1: Create `src/lib/use-realtime.ts`**

```typescript
"use client";

import { useEffect, useRef } from "react";
import { getSupabaseBrowser } from "./supabase-browser";
import type { RealtimeChannel } from "@supabase/supabase-js";

interface RealtimeOptions {
  table: string;
  filter?: string;
  event?: "INSERT" | "UPDATE" | "DELETE" | "*";
  onRecord: (payload: { new: Record<string, unknown>; old: Record<string, unknown>; eventType: string }) => void;
}

export function useRealtime({ table, filter, event = "*", onRecord }: RealtimeOptions) {
  const channelRef = useRef<RealtimeChannel | null>(null);

  useEffect(() => {
    const supabase = getSupabaseBrowser();
    const channelName = `realtime:${table}:${filter || "all"}`;

    const channel = supabase.channel(channelName).on(
      "postgres_changes",
      { event, schema: "public", table, filter },
      (payload) => {
        onRecord({
          new: payload.new as Record<string, unknown>,
          old: payload.old as Record<string, unknown>,
          eventType: payload.eventType,
        });
      }
    ).subscribe();

    channelRef.current = channel;

    return () => {
      supabase.removeChannel(channel);
    };
  }, [table, filter, event]);
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/use-realtime.ts
git commit -m "feat: add Supabase Realtime hook for live updates"
```

---

### Task 5: Chat List Page

**Files:**
- Create: `src/app/app/chat/page.tsx`

- [ ] **Step 1: Create `src/app/app/chat/page.tsx`**

```tsx
"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/lib/use-auth";
import { useRealtime } from "@/lib/use-realtime";
import { getSupabaseBrowser } from "@/lib/supabase-browser";

interface Conversation {
  chat_jid: string;
  last_message: string | null;
  last_type: string;
  last_time: string;
  unread: number;
}

export default function ChatListPage() {
  const { session } = useAuth();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedInstance, setSelectedInstance] = useState<string | null>(null);
  const [instances, setInstances] = useState<{ id: string; name: string }[]>([]);

  useEffect(() => {
    if (!session) return;
    // Load instances
    fetch("/api/instances", {
      headers: { Authorization: `Bearer ${session.access_token}` },
    }).then((r) => r.json()).then((data) => {
      setInstances(data);
      if (data.length > 0) setSelectedInstance(data[0].id);
    });
  }, [session]);

  useEffect(() => {
    if (!selectedInstance) return;
    loadConversations();
  }, [selectedInstance]);

  async function loadConversations() {
    const supabase = getSupabaseBrowser();
    // Get distinct chat_jids with latest message
    const { data } = await supabase
      .from("messages")
      .select("chat_jid, text, type, timestamp")
      .eq("instance_id", selectedInstance!)
      .order("timestamp", { ascending: false })
      .limit(200);

    if (!data) return;

    // Group by chat_jid, take most recent
    const map = new Map<string, Conversation>();
    for (const msg of data) {
      if (!map.has(msg.chat_jid)) {
        map.set(msg.chat_jid, {
          chat_jid: msg.chat_jid,
          last_message: msg.text,
          last_type: msg.type,
          last_time: msg.timestamp,
          unread: 0,
        });
      }
    }
    setConversations(Array.from(map.values()));
  }

  // Live updates
  useRealtime({
    table: "messages",
    filter: selectedInstance ? `instance_id=eq.${selectedInstance}` : undefined,
    event: "INSERT",
    onRecord: () => loadConversations(),
  });

  return (
    <div style={{ display: "flex", height: "100%" }}>
      {/* Sidebar: conversation list */}
      <div style={{
        width: 350, borderRight: "1px solid #ddd", overflowY: "auto",
        background: "#fff",
      }}>
        {/* Instance selector */}
        {instances.length > 1 && (
          <div style={{ padding: "0.5rem", borderBottom: "1px solid #eee" }}>
            <select
              value={selectedInstance || ""}
              onChange={(e) => setSelectedInstance(e.target.value)}
              style={{ width: "100%", padding: "0.4rem" }}
            >
              {instances.map((i) => (
                <option key={i.id} value={i.id}>{i.name}</option>
              ))}
            </select>
          </div>
        )}

        {conversations.length === 0 && (
          <p style={{ padding: "2rem", color: "#999", textAlign: "center" }}>
            Nenhuma conversa ainda
          </p>
        )}

        {conversations.map((conv) => (
          <a
            key={conv.chat_jid}
            href={`/app/chat/${encodeURIComponent(conv.chat_jid)}`}
            style={{
              display: "block", padding: "0.75rem 1rem", borderBottom: "1px solid #f0f0f0",
              textDecoration: "none", color: "inherit",
            }}
          >
            <div style={{ fontWeight: 600, fontSize: "0.95rem", marginBottom: 2 }}>
              {conv.chat_jid.replace(/@.*/, "")}
            </div>
            <div style={{ fontSize: "0.82rem", color: "#667", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {conv.last_type === "audio" ? "Audio" : (conv.last_message || "...")}
            </div>
          </a>
        ))}
      </div>

      {/* Placeholder for when no chat is selected */}
      <div style={{
        flex: 1, display: "flex", alignItems: "center", justifyContent: "center",
        background: "#f0f2f5", color: "#999",
      }}>
        Selecione uma conversa
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/app/chat/page.tsx
git commit -m "feat: add chat list page with Realtime updates"
```

---

### Task 6: Chat Thread Page

**Files:**
- Create: `src/app/app/chat/[chatJid]/page.tsx`

- [ ] **Step 1: Create `src/app/app/chat/[chatJid]/page.tsx`**

```tsx
"use client";

import { useEffect, useState, useRef } from "react";
import { useParams } from "next/navigation";
import { useAuth } from "@/lib/use-auth";
import { useRealtime } from "@/lib/use-realtime";
import { getSupabaseBrowser } from "@/lib/supabase-browser";

interface Message {
  id: string;
  text: string | null;
  type: string;
  from_me: boolean;
  sender: string;
  timestamp: string;
  status: string;
  transcription?: { text: string; summary: string | null } | null;
}

export default function ChatThreadPage() {
  const params = useParams();
  const chatJid = decodeURIComponent(params.chatJid as string);
  const { session } = useAuth();
  const [messages, setMessages] = useState<Message[]>([]);
  const [instanceId, setInstanceId] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!session) return;
    // Get first connected instance
    fetch("/api/instances", {
      headers: { Authorization: `Bearer ${session.access_token}` },
    }).then((r) => r.json()).then((data) => {
      if (data.length > 0) setInstanceId(data[0].id);
    });
  }, [session]);

  useEffect(() => {
    if (!instanceId) return;
    loadMessages();
  }, [instanceId, chatJid]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function loadMessages() {
    const supabase = getSupabaseBrowser();
    const { data } = await supabase
      .from("messages")
      .select(`
        id, text, type, from_me, sender, timestamp, status,
        transcriptions(text, summary)
      `)
      .eq("instance_id", instanceId!)
      .eq("chat_jid", chatJid)
      .order("timestamp", { ascending: true })
      .limit(100);

    if (data) {
      setMessages(data.map((m: any) => ({
        ...m,
        transcription: m.transcriptions?.[0] || null,
      })));
    }
  }

  // Live new messages
  useRealtime({
    table: "messages",
    filter: instanceId ? `instance_id=eq.${instanceId}` : undefined,
    event: "INSERT",
    onRecord: ({ new: msg }) => {
      if ((msg as any).chat_jid === chatJid) loadMessages();
    },
  });

  // Live transcription updates
  useRealtime({
    table: "transcriptions",
    filter: instanceId ? `instance_id=eq.${instanceId}` : undefined,
    event: "INSERT",
    onRecord: () => loadMessages(),
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {/* Header */}
      <div style={{
        padding: "0.75rem 1rem", background: "#ededed", borderBottom: "1px solid #ddd",
        fontWeight: 600,
      }}>
        {chatJid.replace(/@.*/, "")}
      </div>

      {/* Messages */}
      <div style={{
        flex: 1, overflowY: "auto", padding: "1rem",
        background: "#e5ddd5",
        backgroundImage: "url(\"data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23d4cfc6' fill-opacity='0.3'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E\")",
      }}>
        {messages.map((msg) => (
          <div key={msg.id} style={{
            display: "flex",
            justifyContent: msg.from_me ? "flex-end" : "flex-start",
            marginBottom: "0.5rem",
          }}>
            <div style={{
              maxWidth: "65%", padding: "0.5rem 0.75rem", borderRadius: 8,
              background: msg.from_me ? "#dcf8c6" : "#fff",
              boxShadow: "0 1px 1px rgba(0,0,0,0.1)",
            }}>
              {!msg.from_me && (
                <div style={{ fontSize: "0.75rem", color: "#075e54", fontWeight: 600, marginBottom: 2 }}>
                  {msg.sender}
                </div>
              )}

              {msg.type === "audio" ? (
                <div>
                  <div style={{ fontSize: "0.85rem", color: "#999", fontStyle: "italic" }}>
                    Audio
                  </div>
                  {msg.status === "pending_transcription" && (
                    <div style={{ fontSize: "0.78rem", color: "#f90", marginTop: 4 }}>
                      Transcrevendo...
                    </div>
                  )}
                  {msg.transcription && (
                    <div style={{
                      marginTop: 6, padding: "0.5rem", background: "rgba(0,0,0,0.04)",
                      borderRadius: 4, fontSize: "0.85rem",
                    }}>
                      <div style={{ marginBottom: 4 }}>{msg.transcription.text}</div>
                      {msg.transcription.summary && (
                        <div style={{ fontSize: "0.78rem", color: "#555", borderTop: "1px solid rgba(0,0,0,0.08)", paddingTop: 4, marginTop: 4 }}>
                          <strong>Resumo:</strong> {msg.transcription.summary}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ) : (
                <div style={{ fontSize: "0.9rem", whiteSpace: "pre-wrap" }}>{msg.text}</div>
              )}

              <div style={{ fontSize: "0.68rem", color: "#999", textAlign: "right", marginTop: 2 }}>
                {new Date(msg.timestamp).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
              </div>
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add "src/app/app/chat/[chatJid]/page.tsx"
git commit -m "feat: add chat thread page with transcription display and Realtime"
```

---

### Task 7: Service Worker

**Files:**
- Create: `public/sw.js`

- [ ] **Step 1: Create `public/sw.js`**

```javascript
const CACHE_NAME = "transcritor-v1";
const STATIC_ASSETS = ["/", "/app", "/login", "/manifest.webmanifest"];

// Install: cache static assets
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

// Activate: clean old caches
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch: CacheFirst for static, NetworkFirst for API/data
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // API calls: NetworkFirst
  if (url.pathname.startsWith("/api/")) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          return response;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // Static: CacheFirst
  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  );
});

// Push notification
self.addEventListener("push", (event) => {
  const data = event.data?.json() || {};
  event.waitUntil(
    self.registration.showNotification(data.title || "Transcrição pronta", {
      body: data.body || "Um áudio foi transcrito",
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      data: data.url ? { url: data.url } : undefined,
    })
  );
});

// Notification click: open the app
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "/app/chat";
  event.waitUntil(
    self.clients.matchAll({ type: "window" }).then((clients) => {
      for (const client of clients) {
        if (client.url.includes("/app") && "focus" in client) return client.focus();
      }
      return self.clients.openWindow(url);
    })
  );
});
```

- [ ] **Step 2: Register SW in root layout — add to `src/app/layout.tsx`**

Add this script tag inside `<body>` after `{children}`:

```tsx
<script
  dangerouslySetInnerHTML={{
    __html: `
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('/sw.js');
      }
    `,
  }}
/>
```

- [ ] **Step 3: Commit**

```bash
git add public/sw.js src/app/layout.tsx
git commit -m "feat: add service worker with CacheFirst/NetworkFirst and push support"
```

---

### Task 8: Push Notifications API

**Files:**
- Create: `src/lib/push.ts`
- Create: `src/app/api/push/subscribe/route.ts`
- Create: `src/app/api/push/send/route.ts`

- [ ] **Step 1: Create `src/lib/push.ts`** (client-side helper)

```typescript
"use client";

export async function subscribeToPush(accessToken: string): Promise<boolean> {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return false;

  const registration = await navigator.serviceWorker.ready;
  const vapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  if (!vapidKey) return false;

  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(vapidKey),
  });

  const json = subscription.toJSON();
  await fetch("/api/push/subscribe", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      endpoint: json.endpoint,
      keys_p256dh: json.keys?.p256dh,
      keys_auth: json.keys?.auth,
    }),
  });

  return true;
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  return Uint8Array.from(rawData, (char) => char.charCodeAt(0));
}
```

- [ ] **Step 2: Create `src/app/api/push/subscribe/route.ts`**

```typescript
import { getSupabaseServer, getUserFromToken } from "@/lib/supabase-server";

export async function POST(request: Request) {
  const token = request.headers.get("Authorization")?.replace("Bearer ", "");
  if (!token) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const user = await getUserFromToken(token);
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { endpoint, keys_p256dh, keys_auth } = await request.json();
  if (!endpoint || !keys_p256dh || !keys_auth) {
    return Response.json({ error: "Missing subscription data" }, { status: 400 });
  }

  const supabase = getSupabaseServer();
  await supabase.from("push_subscriptions").upsert(
    { user_id: user.id, endpoint, keys_p256dh, keys_auth },
    { onConflict: "endpoint" }
  );

  return Response.json({ ok: true });
}
```

- [ ] **Step 3: Create `src/app/api/push/send/route.ts`**

This is called internally by the worker after transcription. Uses the `web-push` npm package.

```typescript
import { getSupabaseServer } from "@/lib/supabase-server";

export async function POST(request: Request) {
  // Internal endpoint — verify via secret or service role
  const { userId, title, body, url } = await request.json();
  if (!userId) return Response.json({ error: "userId required" }, { status: 400 });

  const supabase = getSupabaseServer();
  const { data: subscriptions } = await supabase
    .from("push_subscriptions")
    .select("endpoint, keys_p256dh, keys_auth")
    .eq("user_id", userId);

  if (!subscriptions || subscriptions.length === 0) {
    return Response.json({ sent: 0 });
  }

  // Dynamic import web-push to keep it server-only
  const webpush = await import("web-push");
  webpush.setVapidDetails(
    "mailto:noreply@transcritor.app",
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!,
    process.env.VAPID_PRIVATE_KEY!
  );

  let sent = 0;
  for (const sub of subscriptions) {
    try {
      await webpush.sendNotification(
        {
          endpoint: sub.endpoint,
          keys: { p256dh: sub.keys_p256dh, auth: sub.keys_auth },
        },
        JSON.stringify({ title: title || "Transcrição pronta", body, url })
      );
      sent++;
    } catch (err: any) {
      if (err.statusCode === 410) {
        // Subscription expired, clean up
        await supabase.from("push_subscriptions").delete().eq("endpoint", sub.endpoint);
      }
    }
  }

  return Response.json({ sent });
}
```

- [ ] **Step 4: Commit**

```bash
git add src/lib/push.ts src/app/api/push/subscribe/route.ts src/app/api/push/send/route.ts
git commit -m "feat: add VAPID push notification subscribe and send endpoints"
```

---

### Task 9: PWA Icons (Placeholder)

**Files:**
- Create: `public/icon-192.png`
- Create: `public/icon-512.png`

- [ ] **Step 1: Generate placeholder icons**

Use a simple colored square as placeholder. Create via canvas or download any 192x192 and 512x512 PNG.

```bash
# Quick placeholder using ImageMagick (if available) or just create empty files
convert -size 192x192 xc:#075e54 public/icon-192.png 2>/dev/null || \
  printf '\x89PNG\r\n\x1a\n' > public/icon-192.png
convert -size 512x512 xc:#075e54 public/icon-512.png 2>/dev/null || \
  printf '\x89PNG\r\n\x1a\n' > public/icon-512.png
```

- [ ] **Step 2: Commit**

```bash
git add public/icon-192.png public/icon-512.png
git commit -m "feat: add placeholder PWA icons"
```

---

### Task 10: Install web-push dependency

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install web-push**

```bash
bun add web-push
bun add -d @types/web-push
```

- [ ] **Step 2: Commit**

```bash
git add package.json bun.lock
git commit -m "feat: add web-push dependency for VAPID notifications"
```
