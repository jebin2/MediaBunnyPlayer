const CACHE_NAME = 'mediabunny-player-v1';

const urlsToCache = [
    '/', // Only if served from root; adjust if deployed in subdirectory

    //html
    '/index.html',
    '/player.html',

    // json
    '/manifest.json',

    // css
    '/css/style.css',
    '/css/main1.css',

    // js
    '/js/audio.js',
    '/js/blur.js',
    '/js/caption.js',
    '/js/constants.js',
    '/js/crop.js',
    '/js/editing.js',
    '/js/eventListeners.js',
    '/js/imageToVideo.js',
    '/js/main.js',
    '/js/merge.js',
    '/js/metadata.js',
    '/js/minimal_player.js',
    '/js/player.js',
    '/js/playlist.js',
    '/js/recording.js',
    '/js/resize.js',
    '/js/screenshot.js',
    '/js/settings.js',
    '/js/state.js',
    '/js/ui.js',
    '/js/utility.js',

    // icon
    '/favicon.ico',
    '/favicon.png',
    '/icons/icon-192x192.svg',
    '/icons/icon-512x512.svg',
    '/media/dynamic_crop.gif',
    '/upload.svg',
];

// Install - pre-cache core assets
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async cache => {
      console.log('[Service Worker] Caching app shell');
      for (const url of urlsToCache) {
        try {
          const response = await fetch(url);
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          await cache.put(url, response);
        } catch (err) {
          console.warn(`[SW] Failed to cache ${url}:`, err.message);
        }
      }
    }).then(() => self.skipWaiting())
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