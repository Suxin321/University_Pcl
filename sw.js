const CACHE = 'pcl-web-v13';
const ASSETS = [
  './',
  './index.html',
  './app.css?v=13',
  './app.js?v=13',
  './core.js?v=13',
  './vendor/xlsx.full.min.js',
  './manifest.webmanifest',
  './icon.svg',
  './icon-192.png',
  './icon-512.png',
  './share-qr.svg'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  event.respondWith(
    caches.match(request).then((hit) => {
      if (hit) return hit;
      return fetch(request).then((response) => {
        if (response && response.ok && request.url.indexOf(self.location.origin) === 0) {
          const clone = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, clone)).catch(() => {});
        }
        return response;
      }).catch(() => hit || Response.error());
    })
  );
});
