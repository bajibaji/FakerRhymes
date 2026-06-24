// Version: v2.4.2
const CACHE_VERSION = 'v2.4.2';
const CACHE_NAME = 'fakerhymes-cache-' + CACHE_VERSION;
const APP_ROOT = new URL('./', self.location.href);
const ASSET_PATHS = [
  './',
  './index.html',
  './custom.html',
  './css/style.css',
  './js/main.js',
  './js/animations.js',
  './js/pkg/wasm_search.js',
  './js/pkg/wasm_search_bg.wasm',
  './manifest.json',
  './icon.svg',
  // dict.txt is NOT pre-cached here to save install time, it's cached on demand
];
const ASSETS = ASSET_PATHS.map((path) => new URL(path, APP_ROOT).toString());

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
      .then((keys) => Promise.all(
        keys
          .filter((key) => key.startsWith('fakerhymes-cache-') && key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin || !url.pathname.startsWith(APP_ROOT.pathname)) return;

  const isDictFile = url.pathname.endsWith('/dict_part1.bin') || url.pathname.endsWith('/dict_part2.bin');

  if (isDictFile) {
    event.respondWith(
      caches.open(CACHE_NAME).then(async (cache) => {
        const cached = await cache.match(request, { ignoreSearch: true });
        if (cached) {
          event.waitUntil(
            fetch(request)
              .then((response) => {
                if (response && response.ok) cache.put(request, response.clone());
              })
              .catch(() => {})
          );
          return cached;
        }

        const response = await fetch(request);
        if (response && response.ok) cache.put(request, response.clone());
        return response;
      })
    );
    return;
  }

  const isAppFile = url.pathname.endsWith('.html') ||
                    url.pathname.endsWith('.css') ||
                    url.pathname.endsWith('.js') ||
                    url.pathname.endsWith('.wasm') ||
                    url.pathname.endsWith('/manifest.json') ||
                    url.pathname.endsWith('/icon.svg') ||
                    url.pathname === APP_ROOT.pathname;

  if (isAppFile) {
    event.respondWith(
      caches.open(CACHE_NAME).then(async (cache) => {
        try {
          const response = await fetch(request);
          if (response && response.ok) cache.put(request, response.clone());
          return response;
        } catch (e) {
          const cached = await cache.match(request, { ignoreSearch: true });
          return cached || new Response('Offline', { status: 503 });
        }
      })
    );
  }
});
