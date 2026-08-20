const CACHE_NAME = 'ai-video-calc-v2-extra-qty-20260820';
const ASSETS = [
  './',
  './index.html',
  './css/app.css',
  './vendor/supabase.min.js',
  './js/cloud-config.js',
  './js/cloud.js',
  './js/calculator.js',
  './js/pricing.js',
  './js/projects.js',
  './js/app.js',
  './data/pricing.json',
  './manifest.webmanifest',
  './icons/ai-calc-logo.png',
  './icons/icon-192.png',
  './icons/icon-512.png'
];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  event.respondWith(fetch(event.request).then(response => {
    const copy = response.clone();
    caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy)).catch(() => {});
    return response;
  }).catch(() => caches.match(event.request).then(cached => cached || caches.match('./index.html'))));
});
