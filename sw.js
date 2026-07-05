/* Anchor service worker — offline-first app shell.
   Bump CACHE when you change index.html or vendored assets to force an update. */
const CACHE = 'anchor-v3';
const ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './vendor/react.js',
  './vendor/react-dom.js',
  './vendor/babel.js',
  './vendor/tailwind.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-512-maskable.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  e.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req).then((res) => {
        // Runtime-cache successful same-origin GETs so the app keeps working offline.
        if (res && res.status === 200 && new URL(req.url).origin === self.location.origin) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      }).catch(() => {
        // Offline navigation → serve the cached shell (crisis tool must never blank out).
        if (req.mode === 'navigate') return caches.match('./index.html');
      });
    })
  );
});
