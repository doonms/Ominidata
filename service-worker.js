const CACHE_NAME = "ominidata-cache-v46";
const urlsToCache = [
  "./",
  "./index.html",
  "./css/style.css",
  "./js/main.js",
  "./js/spaRouter.js",
  "./imagens/logos/logo.png"
].map(path => new URL(path, self.location.href).href);

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log("📦 Cacheando arquivos iniciais");
        return cache.addAll(urlsToCache);
      })
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("fetch", event => {
  event.respondWith(
    caches.match(event.request).then(response => {
      // Retorna do cache ou busca online
      return response || fetch(event.request);
    })
  );
});

self.addEventListener("activate", event => {
  const whitelist = [CACHE_NAME];
  event.waitUntil(
    caches.keys()
      .then(cacheNames =>
        Promise.all(
          cacheNames.map(cacheName => {
            if (!whitelist.includes(cacheName)) {
              console.log("🧹 Limpando cache antigo:", cacheName);
              return caches.delete(cacheName);
            }
          })
        )
      )
      .then(() => self.clients.claim())
  );
});
