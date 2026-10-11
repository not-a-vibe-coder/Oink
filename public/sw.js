/*
 * Oink service worker. Deliberately small: it caches the static app shell and nothing else.
 *
 * Never cached: page HTML (it can embed per-user server-rendered data), server functions,
 * /api/* and any cross-origin request — balances, sessions, encrypted keystores and wallet data
 * always come from the network. Cached: content-hashed build assets, icons, illustrations and
 * fonts, plus one static offline page shown when a navigation fails.
 */
const VERSION = "oink-shell-v1";
const PRECACHE = ["/offline.html", "/icons/icon-192.png", "/manifest.webmanifest"];
const STATIC = /^\/(assets|icons|illustrations|nav)\/|\.woff2$/;

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(VERSION).then((cache) => cache.addAll(PRECACHE)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== VERSION).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    // Network only; the offline page is static and carries no user data.
    event.respondWith(fetch(request).catch(() => caches.match("/offline.html")));
    return;
  }

  if (!STATIC.test(url.pathname)) return;
  event.respondWith(
    caches.match(request).then(
      (hit) =>
        hit ||
        fetch(request).then((response) => {
          if (response.ok && response.type === "basic") {
            const copy = response.clone();
            void caches.open(VERSION).then((cache) => cache.put(request, copy));
          }
          return response;
        }),
    ),
  );
});
