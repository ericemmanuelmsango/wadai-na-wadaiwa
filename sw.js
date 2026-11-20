/* Service worker — mfumo unafunguka hata bila internet.
   - Internet ikiwepo: inachukua toleo JIPYA kila mara (network-first),
     kwa hiyo hukwami kwenye toleo la zamani.
   - Internet ikikosekana au ikiwa dhaifu sana (>7s): inatumia nakala
     iliyohifadhiwa kwenye kifaa.
   - Haigusi kabisa muunganiko wa database (Firestore) — huo una cache yake. */
const SCOPE = self.registration.scope;
const CACHE = "ee-app-v1|" + SCOPE;
const CDN = /^https:\/\/(www\.gstatic\.com\/firebasejs\/|cdn\.jsdelivr\.net\/)/;

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil((async () => {
  const keys = await caches.keys();
  await Promise.all(keys.filter((k) => k.startsWith("ee-app-") && k.endsWith("|" + SCOPE) && k !== CACHE).map((k) => caches.delete(k)));
  await self.clients.claim();
})()));

function mine(url) { return url.startsWith(SCOPE) || CDN.test(url); }

async function put(req, res) {
  try { if (res && (res.ok || res.type === "opaque")) { const c = await caches.open(CACHE); await c.put(req, res); } } catch (e) {}
}
async function cached(req, loose) {
  const c = await caches.open(CACHE);
  return (await c.match(req)) || (loose ? await c.match(req, { ignoreSearch: true }) : undefined) ||
    (req.mode === "navigate" ? (await c.match(SCOPE)) || (await c.match(SCOPE + "index.html")) : undefined);
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET" || req.headers.has("range") || !mine(req.url)) return;
  if (CDN.test(req.url)) {
    // maktaba za Firebase zina namba ya toleo kwenye link — hazibadiliki
    e.respondWith(cached(req).then((hit) => hit || fetch(req).then((res) => { put(req, res.clone()); return res; })));
    return;
  }
  e.respondWith(new Promise((resolve) => {
    let settled = false;
    const done = (r) => { if (!settled && r) { settled = true; resolve(r); } };
    const net = fetch(req).then((res) => { put(req, res.clone()); return res; });
    net.then(done, async () => { done((await cached(req, true)) || Response.error()); });
    setTimeout(async () => { if (!settled) { const hit = await cached(req); if (hit) done(hit); } }, 7000);
  }));
});

self.addEventListener("message", (e) => {
  const d = e.data || {};
  if (d.type !== "ee-cache" || !Array.isArray(d.urls)) return;
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    for (const u of [...new Set(d.urls)].slice(0, 80)) {
      if (!mine(u)) continue;
      try {
        if (await c.match(u)) continue;
        let res; try { res = await fetch(u, { mode: CDN.test(u) ? "cors" : "same-origin" }); } catch (err) { res = await fetch(u, { mode: "no-cors" }); }
        await put(u, res);
      } catch (err) {}
    }
  })());
});
