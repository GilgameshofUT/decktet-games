/* Decktet service worker: the shell loads from cache, every game's page and
   scripts are precached from games.json, and card images are cached as they
   are used — so the games keep working offline (and on a flaky LAN). */

const VERSION = 'decktet-v3';
const SHELL = [
  './',
  'index.html',
  'gallery.html',
  'reference.html',
  'css/app.css',
  'js/decktet.js',
  'js/gamikit.js',
  'js/app.js',
  'games.json',
  'cards/manifest.json',
  'manifest.webmanifest',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'fonts/fortune-letters.ttf',
  'fonts/fortune_widgets.ttf',
];

/** Every game page, its rules, its scripts and its stylesheet. */
async function precacheGames(cache) {
  let games = [];
  try {
    const res = await fetch('games.json');
    games = (await res.json()).games || [];
  } catch {
    return;
  }
  await Promise.all(games.flatMap((g) => [
    g.href, g.rules,
    `js/games/${g.id}.js`,
    `js/games/${g.id}-core.js`,
    `css/${g.id}.css`,
  ].map((u) => cache.add(u).catch(() => {}))));
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(VERSION)
      .then(async (cache) => {
        await cache.addAll(SHELL);
        await precacheGames(cache);
      })
      .then(() => self.skipWaiting())
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

  // navigations: network first, fall back to the cached page (every game page
  // is precached, so deep links keep working offline), then the shell
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

  // code and data: network first (so a deploy is picked up immediately),
  // falling back to the cache when the network is unreachable
  if (/\.(json|css|js|webmanifest|ttf)$/.test(url.pathname)) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(VERSION).then((c) => c.put(req, copy)).catch(() => {});
          }
          return res;
        })
        .catch(() => caches.match(req))
    );
    return;
  }

  // images: cache first, refresh in the background
  if (!/\.(webp|png|jpg|svg|gif)$/.test(url.pathname)) return;
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
