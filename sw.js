/* Pixel Arcade offline cache.
   Serves saved copies first so the games open with no signal, and quietly
   refreshes them in the background when online. Bump VERSION on each release. */
const VERSION = 'arcade-v2';
const LOCAL = [
  './', 'index.html', 'battleships.html', 'four.html', 'memory.html',
  'css/arcade.css', 'css/battleships.css', 'css/four.css', 'css/memory.css',
  'js/arcade.js', 'js/battleships.js', 'js/four.js', 'js/memory.js',
  'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png', 'icons/icon-maskable-512.png',
];
const PEERJS = 'https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js';
const FONT_CSS = 'https://fonts.googleapis.com/css2?family=Press+Start+2P&display=swap';
const CACHE_HOSTS = ['unpkg.com', 'fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(VERSION);
    await cache.addAll(LOCAL);
    try { await cache.add(new Request(PEERJS, { mode: 'cors' })); } catch (e) { /* online-only feature */ }
    try {
      const res = await fetch(FONT_CSS);
      const css = await res.clone().text();
      await cache.put(FONT_CSS, res);
      const fonts = [...css.matchAll(/url\((https:[^)]+)\)/g)].map((m) => m[1]);
      await Promise.all(fonts.map((u) => cache.add(new Request(u, { mode: 'cors' })).catch(() => null)));
    } catch (e) { /* falls back to a system font */ }
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key !== VERSION) await caches.delete(key);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;
  if (!sameOrigin && !CACHE_HOSTS.includes(url.hostname)) return; // e.g. the PeerJS signalling server

  event.respondWith((async () => {
    const cache = await caches.open(VERSION);
    const isPage = req.mode === 'navigate';
    // Invite links (?room=1234) still open the saved page.
    const key = isPage ? url.origin + url.pathname : req;
    const cached = await cache.match(key, { ignoreSearch: isPage });
    const refresh = fetch(req).then((res) => {
      if (res && (res.ok || res.type === 'opaque')) cache.put(key, res.clone());
      return res;
    }).catch(() => null);
    if (cached) { event.waitUntil(refresh); return cached; }
    const fresh = await refresh;
    if (fresh) return fresh;
    if (isPage) return (await cache.match('index.html')) || Response.error();
    return Response.error();
  })());
});
