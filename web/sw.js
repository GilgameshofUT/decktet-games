/* Decktet service worker: the shell loads from cache, cards are cached as they
   are used, so the games keep working offline (and on a flaky LAN). */

const VERSION = 'decktet-v1';
const SHELL = [
  './',
  'index.html',
  'gallery.html',
  'css/app.css',
  'js/decktet.js',
  'js/app.js',
  'cards/manifest.json',
  'manifest.webmanifest',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'games/adaman.html',
  'games/jacynth.html',
  'games/gongor-whist.html',
  'js/games/adaman.js',
  'js/games/adaman-core.js',
  'js/games/jacynth.js',
  'js/games/jacynth-core.js',
  'js/games/gongor-whist.js',
  'js/games/gongor-whist-core.js',
  'css/jacynth.css',
  'css/gongor-whist.css',
  'rules/adaman.html',
  'rules/jacynth.html',
  'rules/gongor-whist.html',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(VERSION).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // navigations: network first, fall back to the cached page (the game pages
  // are precached, so deep links keep working offline), then the shell
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(req, copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match(req)
          .then((hit) => hit || caches.match('index.html'))
          .then((hit) => hit || caches.match('./')))
    );
    return;
  }

  // images and data: cache first, refresh in the background
  const isAsset = /\.(webp|png|jpg|svg|json|css|js|webmanifest)$/.test(url.pathname);
  if (!isAsset) return;
  event.respondWith(
    caches.match(req).then((hit) => {
      const refresh = fetch(req)
        .then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(VERSION).then((c) => c.put(req, copy)).catch(() => {});
          }
          return res;
        })
        .catch(() => hit);
      return hit || refresh;
    })
  );
});
