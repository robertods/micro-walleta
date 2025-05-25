// sw.js (Service Worker Actualizado)
const CACHE_NAME = 'gastos-viaje-pwa-cache-v4'; // Incrementa la versión del caché
const URLS_TO_CACHE = [
    '/',
    'index.html',
    'app.js', // <- Añadido
    'styles.css', // <- Añadido
    'https://unpkg.com/dexie@3/dist/dexie.js', // Sigue siendo un CDN
    'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css', // Sigue siendo un CDN
    'manifest.json',
    'icons/icon-192x192.png',
    'icons/icon-512x512.png'
    // Puedes añadir aquí otras fuentes web de FontAwesome si las descargas localmente
    // por ejemplo: 'webfonts/fa-solid-900.woff2', etc.
];

self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => {
                console.log('Opened cache: ', CACHE_NAME);
                const cachePromises = URLS_TO_CACHE.map(urlToCache => {
                    // Para las URLs de CDN, es bueno tener un catch por si fallan,
                    // pero para los archivos locales, el fallo es más crítico.
                    return cache.add(urlToCache).catch(err => {
                        console.warn(`Failed to cache ${urlToCache}: ${err}`);
                    });
                });
                return Promise.all(cachePromises);
            })
            .then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(cacheNames => {
            return Promise.all(
                cacheNames.map(cacheName => {
                    if (cacheName !== CACHE_NAME) {
                        console.log('Deleting old cache:', cacheName);
                        return caches.delete(cacheName);
                    }
                })
            );
        }).then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', event => {
    if (event.request.method !== 'GET') {
        return;
    }

    event.respondWith(
        caches.match(event.request)
            .then(cachedResponse => {
                if (cachedResponse) {
                    return cachedResponse;
                }
                return fetch(event.request).then(
                    networkResponse => {
                        if (networkResponse && networkResponse.status === 200 &&
                            !event.request.url.startsWith('chrome-extension://')) {
                            const responseToCache = networkResponse.clone();
                            caches.open(CACHE_NAME)
                                .then(cache => {
                                    cache.put(event.request, responseToCache);
                                });
                        }
                        return networkResponse;
                    }
                ).catch(error => {
                    console.error('Fetch failed for: ', event.request.url, error);
                    // Considerar una página offline genérica si es apropiado
                    // if (event.request.mode === 'navigate') {
                    //     return caches.match('/offline.html'); // Necesitarías crear offline.html
                    // }
                });
            })
    );
});
