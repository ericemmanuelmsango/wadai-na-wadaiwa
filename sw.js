/* Minimal service worker: makes the POS installable as an app.
   It never caches anything (so you never get stuck on an old version) and
   only touches page loads — the database connection is left completely alone. */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", (e) => {
  if (e.request.mode === "navigate") e.respondWith(fetch(e.request));
});
