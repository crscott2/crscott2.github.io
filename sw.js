const CACHE = "gsb-v6";
self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});
self.addEventListener("fetch", (e) => {
  const u = new URL(e.request.url);
  const h = u.hostname;
  const isData =
    h === "noaa.gov" ||
    h.endsWith(".noaa.gov") ||
    h === "weather.gov" ||
    h.endsWith(".weather.gov") ||
    h === "stonybrook.edu" ||
    h.endsWith(".stonybrook.edu") ||
    h === "allorigins.win" ||
    h.endsWith(".allorigins.win");
  const isHtml =
    e.request.mode === "navigate" ||
    u.pathname.endsWith(".html") ||
    u.pathname.endsWith(".json") ||
    /\/sw\.js$/i.test(u.pathname);
  if (isData || isHtml) {
    e.respondWith(fetch(e.request, { cache: "no-store" }));
    return;
  }
  e.respondWith(
    fetch(e.request)
      .then((r) => {
        if (e.request.method === "GET" && r && r.ok) {
          const copy = r.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
        }
        return r;
      })
      .catch(() => caches.match(e.request))
  );
});
