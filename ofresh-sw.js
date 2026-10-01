// OFRESH Technician PWA - no application-data caching.
// Network stays authoritative so Google Sheets data and app updates are never trapped in an old cache.
self.addEventListener('install', event => event.waitUntil(self.skipWaiting()));
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
