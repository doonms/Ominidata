const CACHE_NAME = 'ominidata-cache-v53';
const APP_ROOT = new URL('./', self.location.href);

self.addEventListener('install', event => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter(name => name.startsWith('ominidata-cache-') && name !== CACHE_NAME)
      .map(name => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);
  // Nunca intercepta Supabase, APIs, envios ou arquivos de outro aplicativo.
  if (request.method !== 'GET' || url.origin !== APP_ROOT.origin || !url.pathname.startsWith(APP_ROOT.pathname)) return;
  if (!/\.(?:html|js|css|png|jpg|jpeg|svg|webp|ico|woff2?)$/i.test(url.pathname) && url.pathname !== APP_ROOT.pathname) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    try {
      const response = await fetch(request, { cache: 'no-cache' });
      if (response.ok && response.type === 'basic') {
        event.waitUntil(cache.put(request, response.clone()).catch(() => {}));
      }
      return response; // Não salva nem disfarça erros HTTP usando conteúdo antigo.
    } catch (error) {
      const saved = await cache.match(request);
      if (saved) return saved;
      throw error;
    }
  })());
});
