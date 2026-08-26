// Verhoog deze versie elke keer dat je bestanden aanpast/publiceert,
// anders blijft de browser de oude, gecachte versie tonen.
const CACHE_NAME = 'event-counter-v1';

// Bestanden die nodig zijn om de app volledig offline te laten werken.
const urlsToCache = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.json',
  './icon.svg',
  // Externe libraries: ook cachen zodat sorteren en het dashboard
  // (grafiek) offline blijven werken. De tel-knoppen zelf werken
  // ook zonder deze twee bestanden.
  'https://cdn.jsdelivr.net/npm/sortablejs@latest/Sortable.min.js',
  'https://cdn.jsdelivr.net/npm/chart.js'
];

// Bij installatie: alles direct in de cache zetten.
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      // Externe (cross-origin) bestanden apart toevoegen met catch,
      // zodat één mislukte CDN-fetch niet de hele installatie laat falen.
      return Promise.all(
        urlsToCache.map((url) =>
          cache.add(url).catch((err) => {
            console.warn('Kon niet cachen tijdens install:', url, err);
          })
        )
      );
    })
  );
  self.skipWaiting();
});

// Oude cache-versies opruimen zodra de nieuwe service worker actief wordt.
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(
        names
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      )
    )
  );
  self.clients.claim();
});

// Strategie: eerst de cache proberen (snel + werkt offline),
// op de achtergrond de cache verversen als er wél internet is.
self.addEventListener('fetch', (event) => {
  // Alleen GET-requests cachen/afhandelen.
  if (event.request.method !== 'GET') return;

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      const networkFetch = fetch(event.request)
        .then((networkResponse) => {
          // Sla een geldig antwoord op voor volgende keer offline.
          if (networkResponse && networkResponse.status === 200) {
            const responseClone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, responseClone);
            });
          }
          return networkResponse;
        })
        .catch(() => cachedResponse); // Geen internet: val terug op cache.

      // Direct de cache teruggeven indien aanwezig (snel), anders wachten op netwerk.
      return cachedResponse || networkFetch;
    })
  );
});
