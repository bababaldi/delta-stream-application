const assets = __PRECACHE__;
const prefix = `delta-stream:${self.registration.scope}:`;
const cacheName = prefix + __REVISION__;
const urls = new Set(assets.map((path) => new URL(path, self.registration.scope).href));
const indexUrl = new URL("index.html", self.registration.scope).href;

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(cacheName);
    try {
      await cache.addAll([...urls].map((url) => new Request(url, { cache: "reload" })));
    } catch (error) {
      await caches.delete(cacheName);
      throw error;
    }
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key.startsWith(prefix) && key !== cacheName) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

// Updating is an explicit user action: never reload an open calculator or form.
self.addEventListener("message", (event) => {
  if (event.data === "ACTIVATE_UPDATE") event.waitUntil(self.skipWaiting());
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET" || !request.url.startsWith(self.registration.scope)) return;
  const key = urls.has(request.url) ? request.url : request.mode === "navigate" ? indexUrl : null;
  if (!key) return; // Do not cache private inputs, arbitrary URLs or third-party responses.
  event.respondWith((async () => {
    const cache = await caches.open(cacheName);
    return await cache.match(key) ?? fetch(request);
  })());
});
