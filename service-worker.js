const CACHE_NAME = 'mediabunny-player-v1';

// ONLY cache the "Shell" (HTML, CSS, Manifest).
// DO NOT cache the JS modules here. Let the app load them naturally, 
// and the 'fetch' listener below will cache them automatically.
const urlsToCache = [
    '/', 
    '/index.html',
    '/manifest.json',
    '/css/style.css',
    '/css/main1.css',
    // removed all /js/ files to prevent race condition during load
    '/favicon.ico',
    '/upload.svg',
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      console.log('[Service Worker] Pre-caching App Shell only');
      return cache.addAll(urlsToCache);
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(cacheNames => {
            return Promise.all(
                cacheNames.map(cache => {
                    if (cache !== CACHE_NAME) {
                        return caches.delete(cache);
                    }
                })
            );
        }).then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', event => {
    // Skip non-GET requests or browser extensions
    if (event.request.method !== 'GET' || !event.request.url.startsWith('http')) return;

    event.respondWith(
        caches.match(event.request).then(cachedResponse => {
            if (cachedResponse) {
                return cachedResponse;
            }

            // This handles the JS files. 
            // When the main thread requests 'player.js', it comes here.
            // We fetch it from network, return it to UI, AND save a copy to cache.
            return fetch(event.request).then(networkResponse => {
                if (!networkResponse || networkResponse.status !== 200 || networkResponse.type !== 'basic') {
                    return networkResponse;
                }

                const responseToCache = networkResponse.clone();
                caches.open(CACHE_NAME).then(cache => {
                    cache.put(event.request, responseToCache);
                });

                return networkResponse;
            });
        })
    );
});