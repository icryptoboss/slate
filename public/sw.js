const SHELL_CACHE = 'slate-shell-v13';
const PDF_CACHE = 'slate-pdf-v13';

const ASSETS_TO_CACHE = [
  '/',
  '/index.html',
  '/index.css',
  '/app.js',
  '/pdf.min.js',
  '/pdf.worker.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css',
  'https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700&family=Caveat:wght@400;700&family=Playpen+Sans:wght@400;600;800&display=swap'
];

// Install: Cache shell assets
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then(cache => {
      console.log('[Service Worker] Pre-caching app shell');
      return cache.addAll(ASSETS_TO_CACHE);
    }).then(() => self.skipWaiting())
  );
});

// Activate: Clean up old caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cache => {
          if (cache !== SHELL_CACHE && cache !== PDF_CACHE) {
            console.log('[Service Worker] Removing old cache:', cache);
            return caches.delete(cache);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch interception
self.addEventListener('fetch', event => {
  const requestUrl = new URL(event.request.url);

  // 1. Only intercept same-origin requests or verified CDNs
  const isSameOrigin = requestUrl.origin === self.location.origin;
  const isCdn = requestUrl.hostname.includes('cdnjs.cloudflare.com') || 
                requestUrl.hostname.includes('fonts.googleapis.com') ||
                requestUrl.hostname.includes('fonts.gstatic.com');

  if (!isSameOrigin && !isCdn) {
    // Let browser handle other third party requests directly
    return;
  }

  // 2. Specialized caching for PDF file stream proxying
  if (isSameOrigin && requestUrl.pathname.startsWith('/api/files/')) {
    event.respondWith(
      caches.open(PDF_CACHE).then(cache => {
        return cache.match(event.request).then(cachedResponse => {
          if (cachedResponse) {
            console.log('[Service Worker] Serving PDF from cache:', requestUrl.pathname);
            return cachedResponse;
          }

          // If not in cache, fetch it from network, cache a copy, and return
          return fetch(event.request).then(networkResponse => {
            if (networkResponse.status === 200) {
              cache.put(event.request, networkResponse.clone());
            }
            return networkResponse;
          }).catch(err => {
            console.error('[Service Worker] Failed to fetch PDF offline:', err);
            return new Response('Offline: This PDF has not been cached yet.', {
              status: 503,
              statusText: 'Service Unavailable'
            });
          });
        });
      })
    );
    return;
  }

  // 3. Ignore other API requests (like listings or annotations saving)
  if (isSameOrigin && requestUrl.pathname.startsWith('/api/')) {
    return;
  }

  // 4. Default shell assets (Cache First, Network Fallback)
  event.respondWith(
    caches.match(event.request).then(cachedResponse => {
      if (cachedResponse) {
        return cachedResponse;
      }

      return fetch(event.request).then(networkResponse => {
        // Cache dynamic styles/scripts/fonts if they are successful
        if (networkResponse.status === 200 && (isCdn || requestUrl.pathname.endsWith('.js') || requestUrl.pathname.endsWith('.css'))) {
          const responseClone = networkResponse.clone();
          caches.open(SHELL_CACHE).then(cache => {
            cache.put(event.request, responseClone);
          });
        }
        return networkResponse;
      }).catch(() => {
        // Offline fallback for html document
        if (event.request.mode === 'navigate') {
          return caches.match('/index.html');
        }
      });
    })
  );
});
