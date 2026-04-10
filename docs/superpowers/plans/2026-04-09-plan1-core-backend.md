# Plan 1: Core Backend & Multi-tenant Foundation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the multi-tenant backend: database schema, auth, instance management, QR code flow, and Z-API integration from scratch.

**Architecture:** Supabase handles auth + persistence with RLS for tenant isolation. Upstash Redis caches hot session data. Next.js 16 App Router serves API routes. Z-API provides WhatsApp connectivity.

**Tech Stack:** Next.js 16.2.1, Supabase (Postgres + RLS + Auth), Upstash Redis, Z-API, TypeScript.

**IMPORTANT:** Next.js 16 uses standard `Request`/`Response` APIs in route handlers. Check `node_modules/next/dist/docs/` before writing any code. Route handlers return `Response.json()`, not `NextResponse.json()`.

---

## File Structure

```
src/
├── app/
│   ├── layout.tsx                    # Root layout with Geist fonts + PWA meta
│   ├── manifest.ts                   # PWA manifest (Next.js convention)
│   ├── api/
│   │   ├── instances/
│   │   │   ├── route.ts              # GET/POST instance CRUD
│   │   │   └── qr/route.ts           # POST: generate QR, GET: poll status
│   │   └── webhook/
│   │       └── route.ts              # Z-API incoming webhook handler
│   └── (auth)/
│       └── callback/route.ts         # Supabase OAuth callback
├── lib/
│   ├── env.ts                        # Validated env vars
│   ├── supabase-server.ts            # Service-role Supabase client
│   ├── supabase-browser.ts           # Anon-key browser client
│   ├── redis.ts                      # Upstash Redis + session cache
│   └── zapi.ts                       # Z-API URL builder + tenant client
├── middleware.ts                      # Auth middleware for protected routes
supabase/
└── migrations/
    └── 00001_foundation.sql          # All tables: instances, messages, transcriptions, push_subscriptions
```

---

### Task 1: Environment & Supabase Clients

**Files:**
- Create: `src/lib/env.ts`
- Create: `src/lib/supabase-server.ts`
- Create: `src/lib/supabase-browser.ts`

- [ ] **Step 1: Create `src/lib/env.ts`**

```typescript
function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env var: ${name}`);
  return value;
}

export const env = {
  get OPENAI_API_KEY() { return required("OPENAI_API_KEY"); },
  get SUPABASE_URL() { return required("SUPABASE_URL"); },
  get SUPABASE_SERVICE_ROLE_KEY() { return required("SUPABASE_SERVICE_ROLE_KEY"); },
  get UPSTASH_REDIS_REST_URL() { return required("UPSTASH_REDIS_REST_URL"); },
  get UPSTASH_REDIS_REST_TOKEN() { return required("UPSTASH_REDIS_REST_TOKEN"); },
};
```

- [ ] **Step 2: Create `src/lib/supabase-server.ts`**

```typescript
import { createClient } from "@supabase/supabase-js";
import { env } from "./env";

export function getSupabaseServer() {
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
}

export async function getUserFromToken(token: string) {
  const supabase = getSupabaseServer();
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) return null;
  return user;
}
```

- [ ] **Step 3: Create `src/lib/supabase-browser.ts`**

```typescript
import { createBrowserClient } from "@supabase/ssr";

export function getSupabaseBrowser() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
```

- [ ] **Step 4: Commit**

```bash
git add src/lib/env.ts src/lib/supabase-server.ts src/lib/supabase-browser.ts
git commit -m "feat: add environment config and Supabase clients"
```

---

### Task 2: Redis Infrastructure

**Files:**
- Create: `src/lib/redis.ts`

- [ ] **Step 1: Create `src/lib/redis.ts`**

```typescript
import { Redis } from "@upstash/redis";

export const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

export const sessionCache = {
  async get(instanceId: string): Promise<string | null> {
    return await redis.get<string>(`session:${instanceId}`);
  },
  async set(instanceId: string, token: string, ttl = 86400): Promise<void> {
    await redis.set(`session:${instanceId}`, token, { ex: ttl });
  },
  async del(instanceId: string): Promise<void> {
    await redis.del(`session:${instanceId}`);
  },
};
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/redis.ts
git commit -m "feat: add Upstash Redis client with session cache"
```

---

### Task 3: Database Schema

**Files:**
- Create: `supabase/migrations/00001_foundation.sql`

- [ ] **Step 1: Create the migration**

```sql
-- ============================================================
-- INSTANCES: Each user's WhatsApp connection via Z-API
-- ============================================================
CREATE TABLE public.instances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT 'Minha Instância',
  zapi_instance_id TEXT NOT NULL,
  zapi_token TEXT NOT NULL,
  zapi_client_token TEXT,
  session_token TEXT,
  status TEXT NOT NULL DEFAULT 'disconnected'
    CHECK (status IN ('connecting', 'connected', 'disconnected')),
  connected_phone TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.instances ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own instances"
  ON public.instances FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ============================================================
-- MESSAGES: Incoming/outgoing WhatsApp messages
-- ============================================================
CREATE TABLE public.messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  instance_id UUID NOT NULL REFERENCES public.instances(id) ON DELETE CASCADE,
  message_id TEXT NOT NULL,
  chat_jid TEXT NOT NULL,
  sender TEXT,
  text TEXT,
  type TEXT NOT NULL DEFAULT 'text',
  from_me BOOLEAN NOT NULL DEFAULT false,
  media_url TEXT,
  status TEXT NOT NULL DEFAULT 'received',
  timestamp TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_messages_instance_chat ON public.messages(instance_id, chat_jid);
CREATE INDEX idx_messages_status ON public.messages(status);

ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users see own instance messages"
  ON public.messages FOR ALL TO authenticated
  USING (
    instance_id IN (SELECT id FROM public.instances WHERE user_id = auth.uid())
  );

-- ============================================================
-- TRANSCRIPTIONS: Audio transcription results
-- ============================================================
CREATE TABLE public.transcriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id UUID NOT NULL REFERENCES public.messages(id) ON DELETE CASCADE,
  instance_id UUID NOT NULL REFERENCES public.instances(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  summary TEXT,
  duration_ms INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.transcriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users see own transcriptions"
  ON public.transcriptions FOR ALL TO authenticated
  USING (
    instance_id IN (SELECT id FROM public.instances WHERE user_id = auth.uid())
  );

-- ============================================================
-- PUSH_SUBSCRIPTIONS: Web Push notification endpoints
-- ============================================================
CREATE TABLE public.push_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL UNIQUE,
  keys_p256dh TEXT NOT NULL,
  keys_auth TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own push subscriptions"
  ON public.push_subscriptions FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ============================================================
-- Auto-update updated_at trigger
-- ============================================================
CREATE OR REPLACE FUNCTION update_modified_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_instances_modtime
  BEFORE UPDATE ON public.instances
  FOR EACH ROW EXECUTE FUNCTION update_modified_column();

-- ============================================================
-- Enable Realtime for messages and transcriptions
-- ============================================================
ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
ALTER PUBLICATION supabase_realtime ADD TABLE public.transcriptions;
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/00001_foundation.sql
git commit -m "feat: add foundation schema with instances, messages, transcriptions, push_subscriptions"
```

---

### Task 4: Z-API Client

**Files:**
- Create: `src/lib/zapi.ts`

- [ ] **Step 1: Create `src/lib/zapi.ts`**

```typescript
import { getSupabaseServer } from "./supabase-server";
import { sessionCache } from "./redis";

interface ZapiClient {
  baseUrl: string;
  headers: Record<string, string>;
}

/**
 * Build a Z-API client for a specific instance.
 * Checks Redis cache first, falls back to Supabase.
 */
export async function getZapiClient(instanceId: string): Promise<ZapiClient> {
  const supabase = getSupabaseServer();
  const { data, error } = await supabase
    .from("instances")
    .select("zapi_instance_id, zapi_token, zapi_client_token")
    .eq("id", instanceId)
    .single();

  if (error || !data) {
    throw new Error(`Instance ${instanceId} not found`);
  }

  const baseUrl = `https://api.z-api.io/instances/${data.zapi_instance_id}/token/${data.zapi_token}`;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (data.zapi_client_token) {
    headers["Client-Token"] = data.zapi_client_token;
  }

  return { baseUrl, headers };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/zapi.ts
git commit -m "feat: add Z-API client with tenant-aware instance lookup"
```

---

### Task 5: Auth Middleware

**Files:**
- Create: `src/middleware.ts`

- [ ] **Step 1: Create `src/middleware.ts`**

```typescript
import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

export async function middleware(request: NextRequest) {
  const path = request.nextUrl.pathname;

  // Don't protect login, auth callback, API webhook, or public routes
  if (path === "/login" || path.startsWith("/auth/") || path.startsWith("/api/webhook")) {
    return NextResponse.next();
  }

  // Only protect app routes (not API routes which use Bearer tokens)
  if (!path.startsWith("/app")) {
    return NextResponse.next();
  }

  let response = NextResponse.next({ request: { headers: request.headers } });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return request.cookies.getAll(); },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request: { headers: request.headers } });
          cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        },
      },
    }
  );

  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  return response;
}

export const config = {
  matcher: ["/app/:path*"],
};
```

- [ ] **Step 2: Commit**

```bash
git add src/middleware.ts
git commit -m "feat: add auth middleware for /app routes"
```

---

### Task 6: Instance Management API

**Files:**
- Create: `src/app/api/instances/route.ts`

- [ ] **Step 1: Create `src/app/api/instances/route.ts`**

```typescript
import { getSupabaseServer, getUserFromToken } from "@/lib/supabase-server";

export async function GET(request: Request) {
  const token = request.headers.get("Authorization")?.replace("Bearer ", "");
  if (!token) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const user = await getUserFromToken(token);
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const supabase = getSupabaseServer();
  const { data, error } = await supabase
    .from("instances")
    .select("id, name, zapi_instance_id, status, connected_phone, created_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json(data);
}

export async function POST(request: Request) {
  const token = request.headers.get("Authorization")?.replace("Bearer ", "");
  if (!token) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const user = await getUserFromToken(token);
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const { name, zapi_instance_id, zapi_token, zapi_client_token } = body;

  if (!zapi_instance_id || !zapi_token) {
    return Response.json({ error: "zapi_instance_id and zapi_token are required" }, { status: 400 });
  }

  const supabase = getSupabaseServer();
  const { data, error } = await supabase
    .from("instances")
    .insert({
      user_id: user.id,
      name: name || "Minha Instância",
      zapi_instance_id,
      zapi_token,
      zapi_client_token: zapi_client_token || null,
    })
    .select()
    .single();

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json(data, { status: 201 });
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/api/instances/route.ts
git commit -m "feat: add instance management API (GET/POST)"
```

---

### Task 7: QR Code Flow

**Files:**
- Create: `src/app/api/instances/qr/route.ts`

- [ ] **Step 1: Create `src/app/api/instances/qr/route.ts`**

```typescript
import { getSupabaseServer, getUserFromToken } from "@/lib/supabase-server";
import { getZapiClient } from "@/lib/zapi";
import { sessionCache } from "@/lib/redis";

/** POST: Trigger QR code generation for an instance */
export async function POST(request: Request) {
  const token = request.headers.get("Authorization")?.replace("Bearer ", "");
  if (!token) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const user = await getUserFromToken(token);
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { instance_id } = await request.json();
  if (!instance_id) return Response.json({ error: "instance_id required" }, { status: 400 });

  // Verify ownership
  const supabase = getSupabaseServer();
  const { data: instance } = await supabase
    .from("instances")
    .select("id")
    .eq("id", instance_id)
    .eq("user_id", user.id)
    .single();

  if (!instance) return Response.json({ error: "Instance not found" }, { status: 404 });

  const client = await getZapiClient(instance_id);
  const res = await fetch(`${client.baseUrl}/instance/qr`, { headers: client.headers });

  if (!res.ok) {
    return Response.json({ error: `Z-API error: ${await res.text()}` }, { status: res.status });
  }

  // Update status to connecting
  await supabase.from("instances").update({ status: "connecting" }).eq("id", instance_id);

  return Response.json(await res.json());
}

/** GET: Poll connection status */
export async function GET(request: Request) {
  const token = request.headers.get("Authorization")?.replace("Bearer ", "");
  if (!token) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const user = await getUserFromToken(token);
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const instance_id = url.searchParams.get("instance_id");
  if (!instance_id) return Response.json({ error: "instance_id required" }, { status: 400 });

  const supabase = getSupabaseServer();
  const { data: instance } = await supabase
    .from("instances")
    .select("id, zapi_instance_id")
    .eq("id", instance_id)
    .eq("user_id", user.id)
    .single();

  if (!instance) return Response.json({ error: "Instance not found" }, { status: 404 });

  const client = await getZapiClient(instance_id);
  const res = await fetch(`${client.baseUrl}/instance/status`, { headers: client.headers });

  if (!res.ok) {
    return Response.json({ error: `Z-API error: ${await res.text()}` }, { status: res.status });
  }

  const statusData = await res.json();

  // If connected, persist session
  if (statusData.connected) {
    await supabase
      .from("instances")
      .update({
        status: "connected",
        connected_phone: statusData.phoneConnected || null,
        session_token: statusData.sessionToken || null,
      })
      .eq("id", instance_id);

    await sessionCache.set(instance.zapi_instance_id, statusData.sessionToken || "connected");
  }

  return Response.json(statusData);
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/api/instances/qr/route.ts
git commit -m "feat: add QR code generation and connection polling endpoints"
```

---

### Task 8: Webhook Ingress

**Files:**
- Create: `src/app/api/webhook/route.ts`

- [ ] **Step 1: Create `src/app/api/webhook/route.ts`**

This is the Z-API webhook that receives incoming messages and events.

```typescript
import { getSupabaseServer } from "@/lib/supabase-server";

export async function POST(request: Request) {
  const body = await request.json();

  // Z-API sends different event types
  const { phone, event, messageId, chatId, text, type, fromMe, audio, instanceId } = body;

  if (!instanceId) {
    return Response.json({ error: "Missing instanceId" }, { status: 400 });
  }

  const supabase = getSupabaseServer();

  // Look up internal instance by zapi_instance_id
  const { data: instance } = await supabase
    .from("instances")
    .select("id")
    .eq("zapi_instance_id", instanceId)
    .single();

  if (!instance) {
    return Response.json({ error: "Unknown instance" }, { status: 404 });
  }

  // Handle incoming message
  if (event === "message" || event === "message-status-update" || !event) {
    const { error } = await supabase.from("messages").insert({
      instance_id: instance.id,
      message_id: messageId || crypto.randomUUID(),
      chat_jid: chatId || phone || "unknown",
      sender: fromMe ? "me" : (phone || "unknown"),
      text: text || null,
      type: type || "text",
      from_me: fromMe || false,
      media_url: audio?.audioUrl || body.image?.imageUrl || body.video?.videoUrl || null,
      status: type === "audio" ? "pending_transcription" : "received",
    });

    if (error) {
      console.error("Failed to save message:", error.message);
    }
  }

  return Response.json({ received: true });
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/api/webhook/route.ts
git commit -m "feat: add Z-API webhook ingress for incoming messages"
```

---

### Task 9: Root Layout & Manifest

**Files:**
- Create: `src/app/layout.tsx`
- Create: `src/app/manifest.ts`
- Create: `src/app/page.tsx`

- [ ] **Step 1: Create `src/app/layout.tsx`**

```tsx
import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Transcritor WhatsApp",
  description: "Transcrição automática de áudios do WhatsApp",
};

export const viewport: Viewport = {
  themeColor: "#075e54",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" className={`${geistSans.variable} ${geistMono.variable}`}>
      <body style={{ margin: 0, fontFamily: "var(--font-geist-sans), sans-serif" }}>
        {children}
      </body>
    </html>
  );
}
```

- [ ] **Step 2: Create `src/app/manifest.ts`**

```typescript
import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Transcritor WhatsApp",
    short_name: "Transcritor",
    description: "Transcrição automática de áudios do WhatsApp",
    start_url: "/app",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#075e54",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
```

- [ ] **Step 3: Create `src/app/page.tsx`**

```tsx
import { redirect } from "next/navigation";

export default function Home() {
  redirect("/app");
}
```

- [ ] **Step 4: Commit**

```bash
git add src/app/layout.tsx src/app/manifest.ts src/app/page.tsx
git commit -m "feat: add root layout, PWA manifest, and redirect"
```

---

### Task 10: Auth Callback

**Files:**
- Create: `src/app/(auth)/callback/route.ts`

- [ ] **Step 1: Create `src/app/(auth)/callback/route.ts`**

```typescript
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") || "/app";

  if (!code) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  const response = NextResponse.redirect(new URL(next, request.url));

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return request.cookies.getAll(); },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        },
      },
    }
  );

  await supabase.auth.exchangeCodeForSession(code);

  return response;
}
```

- [ ] **Step 2: Commit**

```bash
git add "src/app/(auth)/callback/route.ts"
git commit -m "feat: add Supabase OAuth callback handler"
```
