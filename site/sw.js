// Offline cache for weak signal.
//  - App files: served from the cache at once, refreshed in the background (new code on next visit).
//  - data/meta.json: network first (4 s timeout), cached copy when offline.
//  - Other data files are requested as "?v=<run_id>": kept in the cache until a newer run replaces them,
//    so the big products.json downloads once per update, not on every visit.
const VERSION = "2026-11-09b";
const SHELL = "shell-" + VERSION;
const DATA = "data-v1";
const SHELL_FILES = [
  "./", "index.html", "css/app.css", "manifest.webmanifest", "icon.svg",
  "js/app.js", "js/state.js", "js/ui.js", "js/text.js", "js/search.js", "js/calc.js", "js/calcui.js",
  "js/views/home.js", "js/views/product.js", "js/views/compare.js", "js/views/changes.js", "js/views/settings.js",
  "config/aliases.txt", "config/big_brands.txt",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => Promise.all(SHELL_FILES.map((f) => c.add(f).catch(() => {})))).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== SHELL && k !== DATA).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

const timeout = (ms) => new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), ms));

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return; // product images: normal browser cache
  if (req.cache === "no-store") return;
  const p = url.pathname;

  if (p.includes("/data/")) {
    if (url.searchParams.has("v")) {
      // versioned: cache first; on a new version, drop older copies of the same file
      e.respondWith(caches.open(DATA).then(async (c) => {
        const hit = await c.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok) {
          for (const k of await c.keys()) { const u = new URL(k.url); if (u.pathname === p && u.search !== url.search) c.delete(k); }
          await c.put(req, res.clone());
        }
        return res;
      }));
    } else {
      e.respondWith(caches.open(DATA).then(async (c) => {
        try {
          const res = await Promise.race([fetch(req, { cache: "no-cache" }), timeout(4000)]);
          if (res.ok) await c.put(req, res.clone());
          return res;
        } catch (err) {
          const hit = await c.match(req);
          if (hit) return hit;
          throw err;
        }
      }));
    }
    return;
  }

  // app files: stale-while-revalidate
  e.respondWith(caches.open(SHELL).then(async (c) => {
    const key = req.mode === "navigate" ? "index.html" : req;
    const hit = await c.match(key, { ignoreSearch: req.mode === "navigate" });
    const net = fetch(req).then((res) => { if (res.ok) c.put(key, res.clone()); return res; }).catch(() => null);
    if (hit) { e.waitUntil(net); return hit; }
    return (await net) || new Response("Offline", { status: 503 });
  }));
});
