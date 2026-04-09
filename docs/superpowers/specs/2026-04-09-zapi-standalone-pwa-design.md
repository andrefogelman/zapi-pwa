# Design Spec: Z-API Transcriber Standalone SaaS & PWA

**Date:** 2026-04-09
**Status:** Draft
**Objective:** Transform `zapi-transcriber` into a robust, standalone SaaS product with a PWA that mirrors WhatsApp's functionality and interaction model.

---

## 1. High-Level Architecture (Event-Driven)

The system moves from a request-response model to a reactive, event-driven architecture to ensure scalability and robustness.

### 1.1 The Event Pipeline
`WhatsApp Provider` $\rightarrow$ `Supabase Edge Functions (Ingress)` $\rightarrow$ `Upstash Redis (Queue/State)` $\rightarrow$ `Transcription Workers` $\rightarrow$ `Supabase DB (Persistence)` $\rightarrow$ `WebPush/Realtime` $\rightarrow$ `PWA User`.

### 1.2 Component Breakdown
- **Ingress Layer:** Supabase Edge Functions acting as webhooks to receive events from Z-API.
- **State Layer (Upstash Redis):**
  - **Session Store:** Encrypted WhatsApp session tokens and connection status.
  - **Job Queue:** Redis Streams for asynchronous processing of audio transcriptions.
  - **Presence Store:** Tracks active PWA sessions to optimize notification delivery.
- **Processing Layer:** Workers (Edge Functions or Containers) that handle the Whisper/OpenAI pipeline.
- **Interface Layer:** Next.js PWA utilizing the App Router, Supabase Realtime, and Service Workers.

---

## 2. PWA & User Experience (The WhatsApp Mirror)

### 2.1 Visual & Interaction Model
- **Layout:** Three-column desktop view / Single-column mobile view.
- **Interactions:** 
  - Optimistic UI for message sending and command triggers.
  - Contextual menus (long-press) for message actions.
  - Swipe-to-navigate on mobile.
- **Transcription View:** Nested transcription results directly linked to audio messages, following the WhatsApp visual hierarchy.

### 2.2 PWA Robustness
- **Service Worker Strategy:** 
  - `CacheFirst` for static assets and `NetworkFirst` for chat data.
  - **Background Sync API:** Queuing transcription requests made while offline and executing them upon reconnection.
  - **Push API (VAPID):** Native push notifications for transcription completion and instance disconnection alerts.
- **Offline Mode:** Local caching of the last 50 conversations using IndexedDB/Cache API.

---

## 3. SaaS & Multi-tenancy Logic

### 3.1 Instance Management (Model A)
- **User-Owned Instances:** Each user connects their own WhatsApp account via QR Code.
- **Session Lifecycle:**
  1. User requests session $\rightarrow$ API generates QR Code.
  2. Authentication success $\rightarrow$ Session stored in Supabase (Permanent) & Redis (Hot).
  3. Heartbeat monitor checks connection every 5 minutes.
- **Isolation:** Row-Level Security (RLS) in Supabase ensures users can only access their own sessions and transcriptions.

### 3.2 Transcription Pipeline
1. **Trigger:** Incoming audio event $\rightarrow$ Push to Redis Queue.
2. **Execution:** Worker downloads audio $\rightarrow$ Transcribes via OpenAI $\rightarrow$ Generates summary.
3. **Persistence:** Store result in `transcriptions` table $\rightarrow$ Update `messages` table status.
4. **Notification:** Update Supabase Realtime $\rightarrow$ Dispatch WebPush.

---

## 4. Reliability & Error Handling

- **Resilience:**
  - **Exponential Backoff:** Retries for failed transcription jobs in Redis.
  - **Circuit Breaker:** Global flag to disable Z-API requests if the provider experiences a major outage.
  - **DLQ (Dead Letter Queue):** Jobs failing $>3$ times are moved to a manual review queue.
- **Monitoring:** 
  - Integration with Supabase Logs and Upstash monitoring.
  - User-facing status indicators for "Instance Connection" and "Transcription Queue".

---

## 5. Success Criteria
- [ ] Successful QR Code flow with session persistence in Redis/Supabase.
- [ ] Native Push Notifications delivered to Android/iOS devices.
- [ ] Background Sync correctly processing pending tasks after offline periods.
- [ ] Zero data leakage between tenants (Verified by RLS).
- [ ] UI response time $<<2200ms$ for primary interactions (Optimistic UI).
