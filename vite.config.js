import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';

function emitServiceWorker() {
  return {
    name: 'emit-anchor-service-worker',
    apply: 'build',
    closeBundle() {
      const dist = path.resolve('dist');
      const files = [];
      const walk = (dir) => {
        for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(dir, ent.name);
          if (ent.isDirectory()) walk(full);
          else files.push(full);
        }
      };
      walk(dist);
      const assets = files
        .map((file) => './' + path.relative(dist, file).split(path.sep).join('/'))
        .filter((file) => file !== './sw.js');
      const cache = 'anchor-' + Date.now().toString(36);
      const source = `/* Generated at build time. Precaches the production shell so SOS works offline. */
const CACHE = ${JSON.stringify(cache)};
const ASSETS = ${JSON.stringify(assets, null, 2)};

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.endsWith('/sw.js')) return;

  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const res = await fetch(req);
        const cache = await caches.open(CACHE);
        cache.put('./index.html', res.clone());
        return res;
      } catch (err) {
        const shell = await caches.match('./index.html');
        if (shell) return shell;
        throw err;
      }
    })());
    return;
  }

  event.respondWith((async () => {
    const cached = await caches.match(req);
    if (cached) return cached;
    const res = await fetch(req);
    if (res && res.ok) {
      const cache = await caches.open(CACHE);
      cache.put(req, res.clone());
    }
    return res;
  })());
});
`;
      fs.writeFileSync(path.join(dist, 'sw.js'), source);
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [react(), emitServiceWorker()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: false,
  },
  preview: {
    host: '127.0.0.1',
    port: 4173,
    strictPort: true,
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
  },
});
