// Bump CACHE_NAME to invalidate old caches on deploy. Keep in sync across
// versions so users' stale caches get wiped the next time they open the app.
const CACHE_NAME = "zapi-pwa-v3";

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
      await Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)));
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
