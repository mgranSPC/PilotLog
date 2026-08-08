/* PilotLog service worker — offline-first app shell */
const CACHE = "pilotlog-v11";
const ASSETS = [
  "./",
  "./index.html",
  "./css/style.css",
  "./js/app.js",
  "./js/cloud.js",
  "./manifest.webmanifest",
  "./icons/icon.svg",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png",
];

self.addEventListener("install", e => {
  // No skipWaiting here: the new version waits until the user taps the
  // in-app "Update" banner (which posts SKIP_WAITING), then takes over.
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
});

self.addEventListener("message", e => {
  if (e.data === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", e => {
  if (e.request.method !== "GET") return;
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return;   // e.g. Firebase/Google APIs
  if (url.pathname.startsWith("/__/")) return;  // Firebase reserved URLs (sign-in handler) — never intercept or cache
  e.respondWith(
    // Serve the precached app shell; anything else goes straight to the
    // network (no runtime caching — a cached auth page breaks sign-in).
    caches.match(e.request, { ignoreSearch: true }).then(cached =>
      cached ||
      fetch(e.request).catch(() =>
        e.request.mode === "navigate" ? caches.match("./index.html") : Response.error()
      )
    )
  );
});
