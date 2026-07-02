// Service worker de Noir (PWA).
// Estrategia:
//  - Navegaciones (HTML): network-first con fallback al shell cacheado → la app
//    abre incluso sin conexión y siempre estrena el último index cuando hay red.
//  - Estáticos same-origin (JS/CSS/iconos): stale-while-revalidate.
//  - NUNCA cachea: /api, el stream de audio, peticiones Range, ni orígenes externos.
const CACHE = 'noir-v2';
const SHELL = ['/', '/manifest.json', '/icon.svg', '/icon-192.png', '/icon-512.png', '/icon-maskable-512.png'];

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {}));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    (async () => {
      // Habilita la precarga de navegación (acelera la 1ª respuesta online).
      if (self.registration.navigationPreload) {
        try { await self.registration.navigationPreload.enable(); } catch { /* no soportado */ }
      }
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  );
});

// Permite que la página fuerce la activación de una versión nueva sin esperar.
self.addEventListener('message', (e) => {
  if (e.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (e) => {
  const { request } = e;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Solo gestionamos nuestro propio origen; Spotify/YouTube/googlevideo/fuentes pasan directo.
  if (url.origin !== self.location.origin) return;
  // El backend y el stream de audio nunca se cachean.
  if (url.pathname.startsWith('/api/')) return;
  if (url.pathname.startsWith('/stream-audio') || url.pathname.startsWith('/prefetch-audio')) return;
  // Peticiones Range (audio/seek) → nunca al cache.
  if (request.headers.has('range')) return;

  // Navegaciones → network-first, cae al shell si no hay red.
  if (request.mode === 'navigate') {
    e.respondWith(
      (async () => {
        try {
          const preload = await e.preloadResponse;
          if (preload) return preload;
          const net = await fetch(request);
          const cache = await caches.open(CACHE);
          cache.put('/', net.clone()).catch(() => {});
          return net;
        } catch {
          const cache = await caches.open(CACHE);
          return (await cache.match(request)) || (await cache.match('/')) || Response.error();
        }
      })(),
    );
    return;
  }

  // Estáticos → stale-while-revalidate.
  e.respondWith(
    caches.open(CACHE).then((cache) =>
      cache.match(request).then((cached) => {
        const network = fetch(request)
          .then((res) => {
            // Solo cacheamos respuestas completas y propias (no 206/opacas).
            if (res.ok && res.status === 200 && res.type === 'basic') cache.put(request, res.clone());
            return res;
          })
          .catch(() => cached);
        return cached || network;
      }),
    ),
  );
});
