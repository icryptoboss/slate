// ===== Slate service worker =====
// Strategy:
// - App shell (html/css/js/fonts): cache-first, refreshed in the background.
// - /api/drive-list (folder/file listings): network-first, cache fallback offline.
// - /api/drive-file (PDF bytes): cache-first — once opened, a PDF keeps working offline.

const CACHE_NAME = "slate-cache-v2";
const APP_SHELL = [
  "/",
  "/index.html",
  "/css/style.css",
  "/js/drive.js",
  "/js/drawing-engine.js",
  "/js/pdf-viewer.js",
  "/js/whiteboard.js",
  "/js/app.js",
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.0.379/pdf.min.js",
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.0.379/pdf.worker.min.js",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      cache.addAll(APP_SHELL).catch((err) => console.warn("Precache skipped some assets", err))
    )
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET") return;

  // PDF content — cache-first (PDFs rarely change once uploaded)
  if (url.pathname === "/api/drive-file") {
    event.respondWith(
      caches.open(CACHE_NAME).then(async (cache) => {
        const cached = await cache.match(event.request);
        if (cached) return cached;
        try {
          const fresh = await fetch(event.request);
          if (fresh.ok) cache.put(event.request, fresh.clone());
          return fresh;
        } catch (err) {
          return cached || Promise.reject(err);
        }
      })
    );
    return;
  }

  // Folder/file listings — network-first, cache fallback when offline
  if (url.pathname === "/api/drive-list") {
    event.respondWith(
      fetch(event.request)
        .then((fresh) => {
          if (fresh.ok) caches.open(CACHE_NAME).then((cache) => cache.put(event.request, fresh.clone()));
          return fresh;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // Never cache auth endpoints
  if (url.pathname === "/api/login" || url.pathname === "/api/logout" || url.pathname === "/api/annotations") {
    return;
  }

  // App shell + everything else — cache-first, background refresh
  event.respondWith(
    caches.match(event.request).then((cached) => {
      const network = fetch(event.request)
        .then((fresh) => {
          if (fresh.ok) caches.open(CACHE_NAME).then((cache) => cache.put(event.request, fresh.clone()));
          return fresh;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
