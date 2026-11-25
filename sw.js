/* Bike Maintenance Log service worker — app-shell cache so the logbook
 * works offline in the garage. Version the cache name on release. */
var CACHE = 'bike-maintenance-log-v15';
var ASSETS = [
  './', './index.html', './styles.css', './app.js', './sw-update.js',
  './manifest.webmanifest',
  './icons/icon-192.png', './icons/icon-512.png'
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE).then(function (cache) { return cache.addAll(ASSETS); })
  );
});

/* Update button (sw-update.js): the waiting worker takes over only
 * when the user taps — no skipWaiting on install, or the button
 * would never get a waiting worker to show for. */
self.addEventListener('message', function (e) {
  if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
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
