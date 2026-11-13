/* Bike Maintenance Log service worker — app-shell cache so the logbook
 * works offline in the garage. Version the cache name on release. */
var CACHE = 'bike-maintenance-log-v7';
var ASSETS = [
  './', './index.html', './styles.css', './app.js',
  './manifest.webmanifest',
  './icons/icon-192.png', './icons/icon-512.png', './icons/icon.svg'
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE).then(function (cache) { return cache.addAll(ASSETS); })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE; })
        .map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (event) {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    caches.match(event.request, { ignoreSearch: true }).then(function (cached) {
      return cached || fetch(event.request);
    })
  );
});
