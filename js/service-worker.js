const CACHE_NAME = 'fakerhymes-cache-v1';
const ASSETS = [
  './data.js',
  './manifest.json',
  './dict_optimized.json'
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

  // 大文件（词库）单独处理：缓存优先 + 后台静默更新
  // 目的：避免每次刷新/进入都重新下载 ~40MB，显著降低服务器流量。
  if (url.pathname.endsWith('/dict_optimized.json')) {
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

  // 全部改为网络优先（Network-First）策略
  // 优先尝试网络请求，获取最新版本并更新缓存；如果网络断开，则回退到缓存
  event.respondWith(
    fetch(request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        return response;
      })
      .catch(() => {
        // 网络请求失败，尝试从缓存读取
        if (request.mode === 'navigate') {
           return caches.match(request).then((cached) => cached || caches.match('./index.html'));
        }
        return caches.match(request);
      })
  );
});
