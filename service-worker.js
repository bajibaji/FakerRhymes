// Version: v2.0.4
importScripts('./js/version.js');

const CACHE_VERSION = typeof APP_VERSION !== 'undefined' ? APP_VERSION : 'dev';
const CACHE_NAME = 'fakerhymes-cache-' + CACHE_VERSION;
const APP_ROOT = new URL('./', self.location.href);
const ASSET_PATHS = [
  './',
  './index.html',
  './custom.html',
  './css/style.css',
  './js/data.js',
  './js/db.js',
  './js/main.js',
  './js/version.js',
  './js/animations.js',
  './js/help-modal.js',
  './js/performance-test.js',
  './js/sw-init.js',
  './js/lib/sql-wasm.min.js',
  './js/lib/sql-wasm.wasm',
  './manifest.json',
  './icon.svg',
  './dict_part_1.json',
  './dict_part_2.json',
  './dict_part_3.json'
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

  const isDictFile = url.pathname.endsWith('/dict_part_1.json') ||
                     url.pathname.endsWith('/dict_part_2.json') ||
                     url.pathname.endsWith('/dict_part_3.json');
  const isWasmFile = url.pathname.endsWith('/js/lib/sql-wasm.min.js') ||
                     url.pathname.endsWith('/js/lib/sql-wasm.wasm');

  if (isDictFile || isWasmFile) {
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
