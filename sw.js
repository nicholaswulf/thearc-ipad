// Service Worker: legt die App-Dateien auf dem iPad ab, damit TheArc auch ohne Netz startet.
const CACHE = 'thearc-ipad-v2';
const FILES = [
  './',
  'index.html',
  'style.css',
  'manifest.webmanifest',
  'fonts/inter-tight-latin-wght-normal.woff2',
  'icons/icon-180.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'js/app.js',
  'js/ui.js',
  'js/state.js',
  'js/db.js',
  'js/scan.js',
  'js/covers.js',
  'js/player.js',
  'js/import.js',
  'vendor/sql-wasm.js',
  'vendor/sql-wasm.wasm',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
// Erst Netz (damit Updates ankommen), ohne Netz die gespeicherte Kopie
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request)),
  );
});
