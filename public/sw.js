// ===== Slate service worker =====
// Strategy:
// - App shell (html/css/js/fonts): cache-first, refreshed in the background.
// - /api/drive-list (folder/file listings): network-first, cache fallback offline.
// - /api/drive-file (PDF bytes): cache-first — once opened, a PDF keeps working offline.
// Only same-origin requests and the pinned PDF.js CDN files are intercepted — everything
// else (analytics beacons, etc.) is left alone to avoid interfering with third-party code.

const CACHE_NAME = "slate-cache-v3";
const PDFJS_VERSION = "3.11.174";
const PDFJS_URLS = [
  `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}/build/pdf.min.js`,
  `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}/build/pdf.worker.min.js`,
];
const APP_SHELL = [
  "/",
  "/index.html",
  "/css/style.css",
  "/js/drive.js",
  "/js/drawing-engine.js",
  "/js/pdf-viewer.js",
  "/js/whiteboard.js",
  "/js/app.js",
  ...PDFJS_URLS,
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

async function safePut(cache, request, response) {
  try {
    if (response && response.ok) await cache.put(request, response.clone());
  } catch (err) {
    // Never let a caching failure break the actual response.
    console.warn("SW cache.put skipped:", err);
  }
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET") return;

  const isOwnOrigin = url.origin === self.location.origin;
  const isPdfJsCDN = PDFJS_URLS.includes(request.url);
  if (!isOwnOrigin && !isPdfJsCDN) return; // leave third-party requests (analytics, etc.) alone

  // PDF content — cache-first (PDFs rarely change once uploaded)
  if (url.pathname === "/api/drive-file") {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE_NAME);
        const cached = await cache.match(request);
        if (cached) return cached;
        try {
          const fresh = await fetch(request);
          await safePut(cache, request, fresh);
          return fresh;
        } catch (err) {
          if (cached) return cached;
          throw err;
        }
      })()
    );
    return;
  }

  // Folder/file listings — network-first, cache fallback when offline
  if (url.pathname === "/api/drive-list") {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE_NAME);
        try {
          const fresh = await fetch(request);
          await safePut(cache, request, fresh);
          return fresh;
        } catch (err) {
          const cached = await cache.match(request);
          if (cached) return cached;
          throw err;
        }
      })()
    );
    return;
  }

  // Never cache auth endpoints
  if (url.pathname === "/api/login" || url.pathname === "/api/logout" || url.pathname === "/api/annotations") {
    return;
  }

  // App shell + PDF.js CDN — cache-first, background refresh
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(request);
      const networkFetch = fetch(request)
        .then(async (fresh) => {
          await safePut(cache, request, fresh);
          return fresh;
        })
        .catch(() => cached);
      return cached || networkFetch;
    })()
  );
});
