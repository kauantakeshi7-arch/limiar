/**
 * LIMIAR — Service Worker
 * Suporte completo para PWA, instalação no celular e jogabilidade 100% offline.
 */

const CACHE_NAME = 'limiar-cache-v3';

const PRECACHE_ASSETS = [
  './',
  './index.html',
  './style.css',
  './manifest.json',
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
      // Use allSettled so one missing resource cannot abort the entire offline cache
      await Promise.allSettled(
        PRECACHE_ASSETS.map((asset) =>
          cache.add(asset).catch((err) => console.warn(`[SW] Precache warning for ${asset}:`, err))
        )
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
  // Tenta a rede, mas se a rede falhar (offline ou servidor local desligado),
  // entrega IMEDIATAMENTE o index.html em cache para que o jogo NUNCA mostre tela de erro!
  if (event.request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const networkResponse = await fetch(event.request);
          if (networkResponse && networkResponse.status === 200) {
            const cache = await caches.open(CACHE_NAME);
            cache.put(event.request, networkResponse.clone());
            return networkResponse;
          }
        } catch (_) {
          // Servidor local desligado ou sem conexão: usa cache offline
        }

        const cached = (await caches.match(event.request))
          || (await caches.match('./index.html'))
          || (await caches.match('index.html'))
          || (await caches.match('./'));

        if (cached) return cached;
        return new Response('Offline', { status: 503, statusText: 'Offline' });
      })()
    );
    return;
  }

  // 2. Recursos estáticos (scripts, estilos, ícones, áudio):
  // Stale-While-Revalidate ultra-rápido: entrega o cache em 0ms se presente e atualiza em background
  event.respondWith(
    (async () => {
      const cachedResponse = await caches.match(event.request);
      const networkPromise = fetch(event.request)
        .then(async (networkResponse) => {
          if (networkResponse && networkResponse.status === 200 && (networkResponse.type === 'basic' || networkResponse.type === 'cors')) {
            const cache = await caches.open(CACHE_NAME);
            cache.put(event.request, networkResponse.clone());
          }
          return networkResponse;
        })
        .catch(() => null);

      if (cachedResponse) {
        return cachedResponse;
      }

      const networkRes = await networkPromise;
      if (networkRes) return networkRes;

      return new Response('Offline', { status: 503, statusText: 'Offline' });
    })()
  );
});
