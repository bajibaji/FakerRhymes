const CACHE_NAME = 'faker-rhymes-v1.7.5';
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './custom.html',
  './styles/main.css',
  './scripts/app.js',
  './scripts/rhyme-engine.js',
  './scripts/dict-manager.js',
  './scripts/db.js',
  './data.js',
  './dict_optimized.json',
  './remixicon/remixicon.css',
  './remixicon/remixicon.woff2',
  'https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.2/gsap.min.js',
  'https://cdn.jsdelivr.net/npm/@formkit/auto-animate@0.8.1/index.min.js',
  'https://cdn.jsdelivr.net/npm/pinyin-pro@3.27.0/dist/index.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS_TO_CACHE);
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  // 忽略 API 请求（如果有的话，目前主要是本地资源）
  if (event.request.url.includes('generativelanguage.googleapis.com')) {
    return;
  }

  event.respondWith(
    caches.match(event.request).then((response) => {
      if (response) {
        return response;
      }
      return fetch(event.request).then((networkResponse) => {
        if (!networkResponse || networkResponse.status !== 200 || networkResponse.type !== 'basic') {
          return networkResponse;
        }
        const responseToCache = networkResponse.clone();
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(event.request, responseToCache);
        });
        return networkResponse;
      });
    })
  );
});
