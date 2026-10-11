/*
 * Oink service worker. Deliberately small: it caches the static app shell and nothing else.
 *
 * Never cached: page HTML (it can embed per-user server-rendered data), server functions,
 * /api/* and any cross-origin request — balances, sessions, encrypted keystores and wallet data
 * always come from the network. Cached: content-hashed build assets, icons, illustrations and
 * fonts, plus one static offline page shown when a navigation fails.
 */
const VERSION = "oink-shell-v2";
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

// Push: the server sends only a generic title, sentence and an in-app path.
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {};
  }
  const url = typeof data.url === "string" && data.url.startsWith("/app/") ? data.url : "/app";
  event.waitUntil(
    self.registration.showNotification(typeof data.title === "string" ? data.title.slice(0, 60) : "Oink", {
      body: typeof data.body === "string" ? data.body.slice(0, 140) : "Open Oink to see what changed.",
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      data: { url },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || "/app", self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
      const open = windows.find((client) => client.url.startsWith(self.location.origin));
      if (open) return open.navigate(url).then((client) => (client || open).focus());
      return self.clients.openWindow(url);
    }),
  );
});
