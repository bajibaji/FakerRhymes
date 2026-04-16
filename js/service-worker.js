// Version: v1.9.7
importScripts('version.js');
console.log('Debug: Service Worker initializing. Imported APP_VERSION =', typeof APP_VERSION !== 'undefined' ? APP_VERSION : 'undefined');

const CACHE_NAME = 'fakerhymes-cache-' + APP_VERSION;
console.log('Debug: Service Worker CACHE_NAME =', CACHE_NAME);
const ASSETS = [
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

  // 只缓存词典和 WASM 文件
  const isDictFile = url.pathname.endsWith('/dict_part_1.json') ||
                     url.pathname.endsWith('/dict_part_2.json') ||
                     url.pathname.endsWith('/dict_part_3.json');
  const isWasmFile = url.pathname.includes('sql-wasm.min.js') ||
                     url.pathname.includes('sql-wasm.wasm');

  if (isDictFile || isWasmFile) {
    // 缓存优先 + 后台更新
    event.respondWith(
      caches.open(CACHE_NAME).then(async (cache) => {
        const cached = await cache.match(request);
        if (cached) {
          // 后台更新缓存（失败则继续用旧缓存）
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

  // 其他文件：不缓存，直接走网络
  // 不调用 event.respondWith()，让浏览器直接请求
});
