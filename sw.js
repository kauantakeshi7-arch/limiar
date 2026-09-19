/**
 * LIMIAR — Service Worker
 * Suporte completo para PWA, instalação no celular e jogabilidade 100% offline.
 */

const CACHE_NAME = 'limiar-cache-v1';

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
  './src/systems/InteractionSystem.js',
  './src/systems/PhysicsSystem.js',
  './src/systems/SpawnSystem.js',
  './src/ui/Bestiary.js',
  './src/ui/Diary.js',
  './src/ui/InspectCard.js',
  './src/ui/PWAInstaller.js',
  './src/utils/Color.js',
  './src/utils/Random.js',
  './src/utils/Vector2.js',
  './src/world/Threshold.js',
  './src/world/World.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(PRECACHE_ASSETS);
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

  event.respondWith(
    fetch(event.request)
      .then((networkResponse) => {
        // Se resposta válida, atualiza o cache em segundo plano
        if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });
        }
        return networkResponse;
      })
      .catch(() => {
        // Modo Offline: recupera do cache
        return caches.match(event.request).then((cachedResponse) => {
          if (cachedResponse) {
            return cachedResponse;
          }
          // Fallback para página inicial se for navegação
          if (event.request.mode === 'navigate') {
            return caches.match('./index.html');
          }
          return new Response('Offline', { status: 503, statusText: 'Offline' });
        });
      })
  );
});
