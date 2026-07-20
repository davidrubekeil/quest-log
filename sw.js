/* Quest-Log — Service Worker
   Cache-first für die App-Shell; bei neuer Version CACHE-Namen hochzählen. */

const CACHE = 'questlog-cache-v44';

const ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './icons.js',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(cache => cache.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  // Netlify-Functions (Strava-OAuth/-Sync) nie aus dem Cache bedienen oder abfangen.
  if (new URL(e.request.url).pathname.startsWith('/.netlify/')) return;
  e.respondWith(
    caches.match(e.request).then(cached =>
      cached ||
      fetch(e.request).catch(() => {
        if (e.request.mode === 'navigate') return caches.match('./index.html');
      })
    )
  );
});
