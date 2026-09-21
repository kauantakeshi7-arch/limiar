/**
 * LIMIAR — Service Worker
 * Suporte completo para PWA, instalação no celular e jogabilidade 100% offline.
 */

const CACHE_NAME = 'limiar-cache-v4';

const PRECACHE_ASSETS = [
  './',
  './index.html',
  './style.css',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/icon-192.svg',
  './icons/icon-512.svg',
  './src/main.js',
  './src/core/Config.js',
  './src/core/EventEmitter.js',
  './src/core/Game.js',
  './src/entities/Creature.js',
  './src/entities/DNA.js',
  './src/fx/AudioEngine.js',
  './src/fx/ParticleSystem.js',
  './src/rendering/Renderer.js',
  './src/systems/DecisionSystem.js',
  './src/systems/EvolutionSystem.js',
  './src/systems/GraceSystem.js',
  './src/systems/InteractionSystem.js',
  './src/systems/PhysicsSystem.js',
  './src/systems/SpawnSystem.js',
  './src/ui/Bestiary.js',
  './src/ui/Diary.js',
  './src/ui/GraceMandala.js',
  './src/ui/InspectCard.js',
  './src/ui/PWAInstaller.js',
  './src/utils/Color.js',
  './src/utils/Random.js',
  './src/utils/Vector2.js',
  './src/utils/WakeLock.js',
  './src/world/Threshold.js',
  './src/world/World.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      await Promise.allSettled(
        PRECACHE_ASSETS.map(async (asset) => {
          try {
            const res = await fetch(asset, { cache: 'no-cache' });
            if (res && (res.ok || res.status === 200)) {
              await cache.put(asset, res);
            }
          } catch (err) {
            console.warn(`[SW] Precache warning for ${asset}:`, err);
          }
        })
      );
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  // Ignora requisições que não sejam GET
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);

  // Não intercepta esquemas não suportados como chrome-extension
  if (!url.protocol.startsWith('http')) return;

  // 1. Requisições de navegação (abrir o PWA, recarregar a página, clicar no ícone do celular):
  // Cache-First instantâneo com revalidação em background: abre em 0ms mesmo offline ou com sinal instável!
  if (event.request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE_NAME);

        // Busca no cache primeiro (ignora query params como ?utm_source=homescreen)
        const cached = (await cache.match(event.request, { ignoreSearch: true }))
          || (await cache.match('./index.html', { ignoreSearch: true }))
          || (await cache.match('./', { ignoreSearch: true }))
          || (await cache.match('index.html', { ignoreSearch: true }))
          || (await caches.match(event.request, { ignoreSearch: true }));

        // Se já temos a página em cache, entrega imediatamente em 0ms
        // e atualiza em background se a rede responder
        if (cached) {
          fetch(event.request)
            .then(async (networkResponse) => {
              if (networkResponse && networkResponse.ok && !networkResponse.redirected) {
                await cache.put(event.request, networkResponse.clone());
              }
            })
            .catch(() => {});
          return cached;
        }

        // Se não tinha em cache (primeira visita), busca na rede
        try {
          const networkResponse = await fetch(event.request);
          if (networkResponse && networkResponse.ok) {
            if (!networkResponse.redirected) {
              cache.put(event.request, networkResponse.clone()).catch(() => {});
            }
            return networkResponse;
          }
        } catch (_) {
          // Rede falhou e não tinha cache específico
        }

        // Fallback final: qualquer index.html em qualquer cache
        const fallback = await caches.match('./index.html', { ignoreSearch: true })
          || await caches.match('./', { ignoreSearch: true });
        if (fallback) return fallback;

        return new Response('Offline', { status: 200, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
      })()
    );
    return;
  }

  // 2. Recursos estáticos (scripts, estilos, ícones, fontes):
  // Stale-While-Revalidate com ignoreSearch
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      const cachedResponse = (await caches.match(event.request))
        || (await cache.match(event.request, { ignoreSearch: true }));

      const networkPromise = fetch(event.request)
        .then(async (networkResponse) => {
          if (networkResponse && networkResponse.ok && (networkResponse.type === 'basic' || networkResponse.type === 'cors')) {
            if (!networkResponse.redirected) {
              await cache.put(event.request, networkResponse.clone()).catch(() => {});
            }
          }
          return networkResponse;
        })
        .catch(() => null);

      if (cachedResponse) {
        return cachedResponse;
      }

      const networkRes = await networkPromise;
      if (networkRes) return networkRes;

      return new Response('', { status: 404, statusText: 'Not Found' });
    })()
  );
});
