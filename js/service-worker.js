// Version: v1.9.9
importScripts('version.js');
console.log('Debug: Service Worker initializing. Imported APP_VERSION =', typeof APP_VERSION !== 'undefined' ? APP_VERSION : 'undefined');

const CACHE_NAME = 'fakerhymes-cache-' + APP_VERSION;
console.log('Debug: Service Worker CACHE_NAME =', CACHE_NAME);
const ASSETS = [
  '/index.html',
  '/custom.html',
  '/css/style.css',
  '/js/data.js',
  '/js/db.js',
  '/js/main.js',
  '/js/version.js',
  '/js/animations.js',
  '/js/help-modal.js',
  '/js/performance-test.js',
  '/js/sw-init.js',
  '/manifest.json',
  '/icon.svg',
  '../dict_part_1.json',
  '../dict_part_2.json',
  '../dict_part_3.json',
  './lib/sql-wasm.min.js',
  './lib/sql-wasm.wasm'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  const isDictFile = url.pathname.endsWith('/dict_part_1.json') ||
                     url.pathname.endsWith('/dict_part_2.json') ||
                     url.pathname.endsWith('/dict_part_3.json');
  const isWasmFile = url.pathname.includes('sql-wasm.min.js') ||
                     url.pathname.includes('sql-wasm.wasm');

  if (isDictFile || isWasmFile) {
    // 大文件：缓存优先 + 后台更新
    event.respondWith(
      caches.open(CACHE_NAME).then(async (cache) => {
        const cached = await cache.match(request);
        if (cached) {
          event.waitUntil(
            fetch(request)
              .then((response) => {
                if (response && response.ok) {
                  cache.put(request, response.clone());
                }
              })
              .catch(() => {})
          );
          return cached;
        }

        const response = await fetch(request);
        if (response && response.ok) {
          cache.put(request, response.clone());
        }
        return response;
      })
    );
    return;
  }

  // 应用文件（HTML/CSS/JS）：网络优先，离线时回退缓存
  const isAppFile = url.pathname.endsWith('.html') ||
                    url.pathname.endsWith('.css') ||
                    url.pathname.endsWith('.js') ||
                    url.pathname === '/' ||
                    url.pathname.endsWith('/manifest.json') ||
                    url.pathname.endsWith('/icon.svg') ||
                    url.pathname.endsWith('/index.html') ||
                    url.pathname.endsWith('/custom.html');

  if (isAppFile) {
    event.respondWith(
      caches.open(CACHE_NAME).then(async (cache) => {
        try {
          const response = await fetch(request);
          if (response && response.ok) {
            cache.put(request, response.clone());
          }
          return response;
        } catch (e) {
          const cached = await cache.match(request);
          return cached || new Response('Offline', { status: 503 });
        }
      })
    );
    return;
  }

  // 其他文件：不拦截，由浏览器直接处理
});
