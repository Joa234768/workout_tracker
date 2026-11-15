// Service worker: caches the app shell so the app works offline.
//
// APP_VERSION is defined here and only here. Every release bumps it: the
// browser detects an update by comparing this file byte for byte, and the
// version names the cache. The Settings screen asks this worker for it.
const APP_VERSION = '0.3.0';

const CACHE_PREFIX = 'shell-v';
const CACHE_NAME = `${CACHE_PREFIX}${APP_VERSION}`;

// Every file the app needs to run. tests/precache.test.js fails if a file
// under css/, js/, icons/, lib/ or data/ is missing from this list.
const PRECACHE = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/tokens.css',
  './css/app.css',
  './icons/icon-180.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './js/app.js',
  './js/backup.js',
  './js/db.js',
  './js/router.js',
  './js/sw-client.js',
  './js/logic/backup.js',
  './js/logic/dates.js',
  './js/logic/schema.js',
  './js/ui/banner.js',
  './js/ui/dom.js',
  './js/ui/export-button.js',
  './js/views/today.js',
  './js/views/calendar.js',
  './js/views/progress.js',
  './js/views/exercises.js',
  './js/views/settings.js',
];

// On a local dev server, prefer the network so edits show up immediately.
const IS_LOCAL = ['localhost', '127.0.0.1'].includes(self.location.hostname);

self.addEventListener('install', (event) => {
  // Fetch everything fresh (bypassing the HTTP cache). If any file fails, the
  // install fails and the previous version keeps running.
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      cache.addAll(PRECACHE.map((url) => new Request(url, { cache: 'reload' })))
    )
  );
  // No skipWaiting() here: a new version waits until the user taps the banner.
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(
          names
            .filter((name) => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME)
            .map((name) => caches.delete(name))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  const type = event.data && event.data.type;
  if (type === 'SKIP_WAITING') {
    self.skipWaiting();
  } else if (type === 'GET_VERSION' && event.ports[0]) {
    event.ports[0].postMessage({ version: APP_VERSION });
  }
});

async function fromCache(request) {
  const cache = await caches.open(CACHE_NAME);
  const hit = await cache.match(request, { ignoreSearch: true });
  if (hit) return hit;
  if (request.mode === 'navigate') return cache.match('./index.html');
  return undefined;
}

async function cacheFirst(request) {
  return (await fromCache(request)) || fetch(request);
}

async function networkFirst(request) {
  try {
    return await fetch(request);
  } catch (err) {
    const hit = await fromCache(request);
    if (hit) return hit;
    throw err;
  }
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  if (new URL(request.url).origin !== self.location.origin) return;
  event.respondWith(IS_LOCAL ? networkFirst(request) : cacheFirst(request));
});
