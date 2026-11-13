// VERA's service worker (#243): makes the dashboards installable, and shows a
// "No connection" page instead of the browser's error when a page can't load.
//
// It never caches VERA's pages or data: a page always comes from the network, so
// an update reaches every installed icon the next time it opens. Only the offline
// page and the icons are kept. Requests to other sites (VERA's Apps Script, Google)
// are left alone.
var VERA_SW_CACHE = 'vera-shell-v1';
var VERA_SW_SHELL = ['offline.html', 'icons/vera-full-192.png', 'icons/vera-lite-192.png'];

self.addEventListener('install', function (event) {
  event.waitUntil(caches.open(VERA_SW_CACHE).then(function (c) { return c.addAll(VERA_SW_SHELL); }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (event) {
  event.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k.indexOf('vera-shell-') === 0 && k !== VERA_SW_CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener('fetch', function (event) {
  var req = event.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;            // VERA's backend and anything else: untouched
  if (req.mode === 'navigate') {                               // a page: the network, else "No connection"
    event.respondWith(fetch(req).catch(function () { return caches.match('offline.html'); }));
    return;
  }
  if (VERA_SW_SHELL.some(function (p) { return url.pathname.slice(-p.length) === p; })) {
    event.respondWith(caches.match(req).then(function (hit) { return hit || fetch(req); }));
  }
});
