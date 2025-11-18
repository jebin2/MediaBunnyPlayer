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
    '/MediaBunnyPlayer/js/recording.js',
    '/MediaBunnyPlayer/js/tweet_generator.js',
    '/MediaBunnyPlayer/js/resize.js',
    '/MediaBunnyPlayer/js/screenshot.js',
    '/MediaBunnyPlayer/js/settings.js',
    '/MediaBunnyPlayer/js/state.js',
    '/MediaBunnyPlayer/js/ui.js',
    '/MediaBunnyPlayer/js/utility.js',

    // icon
    '/MediaBunnyPlayer/favicon.ico',
    '/MediaBunnyPlayer/favicon.png',
    '/MediaBunnyPlayer/icons/icon-192x192.svg',
    '/MediaBunnyPlayer/icons/icon-512x512.svg',
    '/MediaBunnyPlayer/media/dynamic_crop.gif',
    '/MediaBunnyPlayer/upload.svg',
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