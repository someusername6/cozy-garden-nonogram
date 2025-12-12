// Cozy Garden Service Worker
// Provides offline capability and caching

const CACHE_NAME = 'cozy-garden-v20';
const STATIC_CACHE = 'cozy-garden-static-v20';
const DATA_CACHE = 'cozy-garden-data-v1';

// Files to cache immediately on install
const STATIC_FILES = [
  '/',
  '/index.html',
  '/css/style.css',
  '/js/app.js',
  '/js/utils.js',
  '/js/game.js',
  '/js/screens.js',
  '/js/storage.js',
  '/js/history.js',
  '/js/collection.js',
  '/js/zoom.js',
  '/data/puzzles.js',
  '/manifest.json',
  // Icons referenced in HTML and manifest
  '/assets/icons/icon-16.png',
  '/assets/icons/icon-32.png',
  '/assets/icons/icon-72.png',
  '/assets/icons/icon-96.png',
  '/assets/icons/icon-128.png',
  '/assets/icons/icon-144.png',
  '/assets/icons/icon-152.png',
  '/assets/icons/icon-192.png',
  '/assets/icons/icon-384.png',
  '/assets/icons/icon-512.png',
  '/assets/icons/apple-touch-icon.png',
  '/assets/icons/maskable-512.png'
];

// Install event - cache static assets
self.addEventListener('install', (event) => {
  console.log('[SW] Installing service worker...');

  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then((cache) => {
        console.log('[SW] Caching static files');
        return cache.addAll(STATIC_FILES);
      })
      .then(() => {
        console.log('[SW] Static files cached');
        return self.skipWaiting();
      })
      .catch((err) => {
        console.error('[SW] Failed to cache static files:', err);
      })
  );
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  console.log('[SW] Activating service worker...');

  event.waitUntil(
    caches.keys()
      .then((cacheNames) => {
        return Promise.all(
          cacheNames
            .filter((name) => {
              // Delete old versions of our caches
              return name.startsWith('cozy-garden-') &&
                     name !== STATIC_CACHE &&
                     name !== DATA_CACHE;
            })
            .map((name) => {
              console.log('[SW] Deleting old cache:', name);
              return caches.delete(name);
            })
        );
      })
      .then(() => {
        console.log('[SW] Service worker activated');
        return self.clients.claim();
      })
  );
});

// Fetch event - serve from cache, fallback to network
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET requests
  if (request.method !== 'GET') {
    return;
  }

  // Skip chrome-extension and other non-http(s) requests
  if (!url.protocol.startsWith('http')) {
    return;
  }

  // Handle different types of requests
  if (isStaticAsset(url)) {
    // Cache-first strategy for static assets
    event.respondWith(cacheFirst(request, STATIC_CACHE));
  } else if (isPuzzleData(url)) {
    // Cache-first with network update for puzzle data
    event.respondWith(staleWhileRevalidate(request, DATA_CACHE));
  } else {
    // Network-first for other requests (HTML pages)
    event.respondWith(networkFirst(request, STATIC_CACHE));
  }
});

// Helper functions

function isStaticAsset(url) {
  const staticExtensions = ['.css', '.js', '.png', '.jpg', '.jpeg', '.gif', '.svg', '.woff', '.woff2'];
  return staticExtensions.some(ext => url.pathname.endsWith(ext));
}

function isPuzzleData(url) {
  return url.pathname.includes('/data/') || url.pathname.includes('puzzles');
}

// Cache-first strategy
async function cacheFirst(request, cacheName) {
  const cached = await caches.match(request);
  if (cached) {
    return cached;
  }

  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    console.error('[SW] Cache-first fetch failed:', error);
    return new Response('Offline', { status: 503 });
  }
}

// Network-first strategy
async function networkFirst(request, cacheName) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    console.log('[SW] Network failed, trying cache:', request.url);
    const cached = await caches.match(request);
    if (cached) {
      return cached;
    }

    // Return offline page for navigation requests
    if (request.mode === 'navigate') {
      const offlinePage = await caches.match('/index.html');
      if (offlinePage) {
        return offlinePage;
      }
    }

    return new Response('Offline', { status: 503 });
  }
}

// Stale-while-revalidate strategy
async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);

  const fetchPromise = fetch(request)
    .then((response) => {
      if (response.ok) {
        cache.put(request, response.clone());
      }
      return response;
    })
    .catch(() => cached);

  return cached || fetchPromise;
}

// Handle messages from the main app
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }

  if (event.data && event.data.type === 'GET_VERSION') {
    event.ports[0].postMessage({ version: CACHE_NAME });
  }
});

