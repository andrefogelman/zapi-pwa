# Design Spec: WaClaw — Multi-Tenant WhatsApp Client

**Date:** 2026-04-10
**Status:** Approved
**Objective:** Build a self-hosted, multi-tenant WhatsApp client service (WaClaw) that wraps the `wacli` CLI to provide message history, backfill, sync, and search — features that Z-API cannot offer. Users choose between WaClaw or Z-API per instance.

---

## 1. Architecture

```
┌─────────────────────────────────────────────────┐
│  Next.js App (Vercel)                           │
│  ┌───────────────────────────────────────────┐  │
│  │ /api/waclaw/[...path]  (proxy to worker5) │  │
│  │ /api/webhook            (Z-API fallback)   │  │
│  │ /api/instances          (manages both)     │  │
│  └───────────────────────────────────────────┘  │
└──────────┬──────────────────┬───────────────────┘
           │ Tailscale        │ HTTPS
           ▼                  ▼
┌──────────────────┐  ┌──────────────┐
│  WaClaw          │  │  Z-API       │
│  worker5:3100    │  │  (external)  │
│                  │  │              │
│  Session Manager │  │  Per-instance│
│  ├─ tenant-a/    │  │  tokens      │
│  ├─ tenant-b/    │  └──────────────┘
│  └─ tenant-c/    │
│                  │
│  REST API        │
│  Sync Daemon     │
│  Webhook Fwd     │
└──────────────────┘
```

### Provider Choice

Each instance in the `instances` table has a `provider` field: `"waclaw"` or `"zapi"`. The frontend and API layer route accordingly:

- **WaClaw instances:** All data flows through WaClaw API on worker5. Full history, backfill, search.
- **Z-API instances:** Data flows through Z-API webhooks → Supabase. No historical backfill.

---

## 2. WaClaw Service (worker5)

### 2.1 Tech Stack
- **Runtime:** Node.js + Fastify
- **wacli binary:** `/home/orcabot/.local/bin/wacli` (Go, wraps whatsmeow)
- **Storage:** One wacli store directory per tenant at `/opt/waclaw/sessions/{session_id}/`
- **Port:** 3100 (Tailscale-only access)

### 2.2 Session Lifecycle

1. **Create:** API call creates directory, runs `wacli auth --store /opt/waclaw/sessions/{id}/` → returns QR code
2. **Connect:** User scans QR → wacli completes auth → session marked `connected`
3. **Sync:** Daemon runs `wacli sync --store {path}` every 2 minutes per active session
4. **Backfill:** On-demand `wacli history backfill --store {path} --chat {phone}` to pull older messages
5. **Disconnect:** User disconnects → stop sync, preserve store for reconnection

### 2.3 REST API

All endpoints require `X-API-Key` header (shared secret between Vercel app and WaClaw).

```
Sessions:
  POST   /sessions                    → create session, returns {id}
  GET    /sessions/:id/qr             → returns QR code (base64 PNG)
  GET    /sessions/:id/status         → {connected, phone, lastSync}
  DELETE /sessions/:id                → disconnect + cleanup

Chats:
  GET    /sessions/:id/chats          → [{jid, name, lastMessage, lastTs, unread}]

Messages:
  GET    /sessions/:id/messages/:jid?limit=50&before=<ts>  → paginated messages
  GET    /sessions/:id/search?q=<term>&limit=20            → FTS search results

Actions:
  POST   /sessions/:id/send           → {to, message} or {to, file, caption}
  POST   /sessions/:id/backfill/:jid  → trigger history backfill for a chat

Health:
  GET    /health                       → {ok, activeSessions, uptime}
```

### 2.4 Sync Daemon

- Runs in-process (setInterval)
- Iterates all `connected` sessions every 2 minutes
- Executes `wacli sync --store {path} --json` via child_process
- On new messages: forwards to configured webhook URL (the Next.js app)

### 2.5 Webhook Forwarding

When WaClaw sync picks up new messages, it POSTs them to the Next.js webhook in a normalized format:

```json
{
  "source": "waclaw",
  "sessionId": "abc-123",
  "messageId": "MSG_ID",
  "phone": "5511999999999",
  "senderName": "Contact Name",
  "fromMe": false,
  "timestamp": 1775792195000,
  "type": "text",
  "text": "message content",
  "audio": null
}
```

This allows the webhook handler to save to Supabase using the same code path as Z-API messages.

---

## 3. Database Changes

### 3.1 Instances Table — Add Provider

```sql
ALTER TABLE public.instances ADD COLUMN provider TEXT NOT NULL DEFAULT 'zapi'
  CHECK (provider IN ('waclaw', 'zapi'));
ALTER TABLE public.instances ADD COLUMN waclaw_session_id TEXT;
```

### 3.2 No Other Schema Changes

Messages from WaClaw flow through the same webhook → `messages` table. The `instance_id` foreign key provides tenant isolation regardless of provider.

---

## 4. Next.js Changes

### 4.1 WaClaw Proxy

`src/app/api/waclaw/[...path]/route.ts` — proxies authenticated requests to `worker5:3100` via Tailscale. Only allows requests from users who own a WaClaw instance.

### 4.2 Unified Chat Experience

The frontend checks `instance.provider` and routes data fetches accordingly:

- **Chat list:** WaClaw → `GET /api/waclaw/sessions/:id/chats` | Z-API → `GET /api/chats`
- **Messages:** WaClaw → `GET /api/waclaw/sessions/:id/messages/:phone` | Z-API → Supabase query
- **Search:** WaClaw → `GET /api/waclaw/sessions/:id/search?q=` | Z-API → Supabase FTS (future)

### 4.3 Instance Creation Flow

Updated to show provider choice:

1. User clicks "+ Nova Instância"
2. Chooses: **WaClaw** (histórico completo) or **Z-API** (oficial, sem histórico)
3. WaClaw: QR code from WaClaw API → scan → connected
4. Z-API: enters Z-API credentials → QR from Z-API → connected

---

## 5. Resource Estimates (20 tenants)

| Resource | Per Session | 20 Sessions |
|----------|------------|-------------|
| RAM | ~60MB | ~1.2GB |
| Disk (store) | ~50MB | ~1GB |
| CPU (sync) | minimal | minimal |
| worker5 total | — | ~1.5GB RAM, ~1GB disk |

worker5 can handle this comfortably.

---

## 6. Risk Mitigation

- **Ban risk:** whatsmeow protocol is unofficial. Mitigations:
  - Rate limit sync to every 2 min (not aggressive)
  - No bulk messaging features
  - Keep session count low (<20)
  - If a session is banned, user can switch to Z-API fallback
- **Worker5 failure:** WaClaw service restarts via systemd. Sessions persist on disk.
- **wacli binary updates:** Pin version, test before updating.

---

## 7. Success Criteria

- [ ] WaClaw service running on worker5 with systemd
- [ ] Create session + QR code flow working
- [ ] Chat list with names and timestamps from wacli.db
- [ ] Message history with pagination (50 msgs per page)
- [ ] History backfill pulling older messages on demand
- [ ] Full-text search across messages
- [ ] Webhook forwarding new messages to Next.js app
- [ ] Frontend seamlessly switches between WaClaw and Z-API instances
- [ ] Provider choice on instance creation
