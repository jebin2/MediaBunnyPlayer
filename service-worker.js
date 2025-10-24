const CACHE_NAME = 'mediabunny-player-v1';

const urlsToCache = [
    '/', // Only if served from root; adjust if deployed in subdirectory
    '/index.html',
    '/player.html',
    '/manifest.json',
    '/css/style.css',
    '/js/main.js',
    '/js/player.js',
    '/js/constants.js',
    '/js/state.js',
    '/js/ui.js',
    '/js/audio.js',
    '/js/settings.js',
    '/js/eventListeners.js',
    '/favicon.ico',
    '/icons/icon-192x192.svg',
    '/icons/icon-512x512.svg'
];

// Install - pre-cache core assets
self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => {
                console.log('[Service Worker] Caching app shell');
                return cache.addAll(urlsToCache);
            })
            .then(() => self.skipWaiting())
    );
});

// Activate - clean up old caches
self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(cacheNames => {
            return Promise.all(
                cacheNames.map(cache => {
                    if (cache !== CACHE_NAME) {
                        console.log('[Service Worker] Removing old cache:', cache);
                        return caches.delete(cache);
                    }
                })
            );
        }).then(() => self.clients.claim())
    );
});

// Fetch - serve from cache first, fallback to network
self.addEventListener('fetch', event => {
    event.respondWith(
        caches.match(event.request)
            .then(response => {
                // Serve from cache if available
                if (response) return response;

                // Fetch and cache dynamically
                return fetch(event.request).then(networkResponse => {
                    if (
                        !networkResponse ||
                        networkResponse.status !== 200 ||
                        networkResponse.type !== 'basic'
                    ) {
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