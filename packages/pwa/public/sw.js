// Bump CACHE_NAME to invalidate old caches on deploy. Keep in sync across
// versions so users' stale caches get wiped the next time they open the app.
const CACHE_NAME = "zapi-pwa-v4";
// Media is content-addressed by (chatJid, msgId) — the bytes for a given
// msgId never change. Cache it aggressively, across sessions, in its own
// bucket so we can cap and purge independently of the app shell.
const MEDIA_CACHE = "zapi-media-v1";
// Soft cap: when the media cache grows past this, evict the oldest entries
// until we're back under. 800 entries ≈ a few hundred MB in practice.
const MEDIA_CACHE_MAX = 800;

// Build a cache key that drops the auth `token` query param so re-logging in
// doesn't invalidate the entire media library. Kept as a Request so the
// cache API treats it like a normal entry.
function mediaCacheKey(request) {
  const u = new URL(request.url);
  u.searchParams.delete("token");
  return new Request(u.toString(), { method: "GET" });
}

// Trim to MEDIA_CACHE_MAX by deleting oldest insertions. keys() returns in
// insertion order so the first N over the cap are the least recently added.
async function trimMediaCache() {
  const cache = await caches.open(MEDIA_CACHE);
  const keys = await cache.keys();
  if (keys.length <= MEDIA_CACHE_MAX) return;
  const excess = keys.length - MEDIA_CACHE_MAX;
  for (let i = 0; i < excess; i++) await cache.delete(keys[i]);
}

// True when the path points at a binary asset we want persisted across
// sessions: message media and contact avatars served through the proxy.
function isMediaPath(pathname) {
  return (
    pathname.startsWith("/api/waclaw/") &&
    (pathname.includes("/media/") || pathname.includes("/avatar/"))
  );
}

// Only cache permanent assets at install time. HTML pages MUST NOT be cached
// here — they reference hashed _next/static chunks that change every deploy.
const PERMANENT_ASSETS = ["/icon-192.png", "/manifest.webmanifest"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      // addAll is all-or-nothing; use individual puts so a missing icon
      // doesn't break install.
      Promise.all(
        PERMANENT_ASSETS.map((url) =>
          fetch(url).then((res) => res.ok && cache.put(url, res)).catch(() => {})
        )
      )
    )
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      const keep = new Set([CACHE_NAME, MEDIA_CACHE]);
      await Promise.all(keys.filter((k) => !keep.has(k)).map((k) => caches.delete(k)));
      await self.clients.claim();
    })()
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);

  // Only handle same-origin requests. Never intercept cross-origin (API calls
  // to waclaw, DiceBear, Supabase, OpenAI, etc. should go straight to network).
  if (url.origin !== self.location.origin) return;

  // Navigation requests (HTML pages): always network, never cache.
  // This is the rule that was broken in v1: caching HTML permanently made
  // stale builds reference missing _next chunks.
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req).catch(() => caches.match("/") || new Response("Offline", { status: 503 }))
    );
    return;
  }

  // Next.js hashed static assets: cache-first (immutable by content hash).
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(
      caches.match(req).then((cached) => {
        if (cached) return cached;
        return fetch(req).then((res) => {
          if (res.ok) {
            const clone = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
          }
          return res;
        });
      })
    );
    return;
  }

  // Media / avatars: cache-first with a token-less key so re-login doesn't
  // invalidate the library. Bytes are immutable per (chatJid, msgId), so a
  // cache hit can skip the network entirely — which is what makes reopening
  // a chat show every thumbnail instantly even across reloads or days later.
  if (isMediaPath(url.pathname)) {
    const key = mediaCacheKey(req);
    event.respondWith(
      (async () => {
        const cache = await caches.open(MEDIA_CACHE);
        const cached = await cache.match(key);
        if (cached) return cached;
        try {
          const res = await fetch(req);
          if (res.ok) {
            // Clone before consuming — cache.put takes a fresh body.
            cache.put(key, res.clone()).then(trimMediaCache).catch(() => {});
          }
          return res;
        } catch (err) {
          // Network dead: return whatever we have, even a stale match.
          return cached || new Response("Offline", { status: 503 });
        }
      })()
    );
    return;
  }

  // API routes: network-first with fallback to cache
  if (url.pathname.startsWith("/api/")) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const clone = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
          }
          return res;
        })
        .catch(() => caches.match(req).then((c) => c || new Response("Offline", { status: 503 })))
    );
    return;
  }

  // Everything else: network only (icons, manifest, etc.)
  // The install step pre-cached the permanent ones for offline use.
  event.respondWith(
    fetch(req).catch(() => caches.match(req) || new Response("", { status: 404 }))
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
  const url = event.notification.data?.url || "/app";
  event.waitUntil(
    self.clients.matchAll({ type: "window" }).then((clients) => {
      for (const client of clients) {
        if (client.url.includes("/app") && "focus" in client) return client.focus();
      }
      return self.clients.openWindow(url);
    })
  );
});
