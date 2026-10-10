// BrainStorm service worker: makes the app installable and quick to open.
// Pages are fetched fresh when online; the app shell is kept for offline starts.
const CACHE = 'brainstorm-shell-v28';
const SHELL = ['/', '/styles.css?v=17', '/app.js?v=25', '/config.js?v=23', '/supabase.min.js?v=2.45.4', '/icons/storm-hero.webp', '/icons/jungle-hero.webp?v=2', '/icons/wordmark.webp', '/icons/wordmark-600.webp', '/icons/neonwhite-hero.webp?v=3', '/icons/wordmark-light.webp?v=4', '/icons/wordmark-light-600.webp?v=4', '/icons/icon-nw-96.png?v=3', '/icons/icon-nw-64.webp?v=3', '/icons/icon-96.png', '/icons/logo-storm-192.png', '/icons/bg/storm-portrait.webp', '/icons/bg/storm-landscape.webp', '/icons/bg/neonwhite-portrait.webp', '/icons/bg/neonwhite-landscape.webp', '/icons/bg/jungle-portrait.webp', '/icons/bg/jungle-landscape.webp', '/icons/logo-neon-white-192.png', '/icons/logo-jungle-192.png', '/icons/icon-64.webp', '/icons/app-icon-192.png', '/icons/app-apple-touch-180.png', '/icons/favicon-32.png', '/icons/logo-storm-128.webp', '/icons/logo-neon-white-128.webp', '/icons/logo-jungle-128.webp'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return; // never cache chat data
  // Pictures and versioned files never change at the same address: serve the saved copy instantly.
  if (url.pathname.startsWith('/icons/') || url.search.includes('v=')) {
    e.respondWith(caches.match(e.request).then((hit) => hit || fetch(e.request).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
      return res;
    })));
    return;
  }
  e.respondWith(fetch(e.request).then((res) => {
    const copy = res.clone();
    caches.open(CACHE).then((c) => c.put(e.request, copy));
    return res;
  }).catch(() => caches.match(e.request).then((r) => r || caches.match('/'))));
});

// Push alerts (switched on in the next phase)
self.addEventListener('push', (e) => {
  let data = {};
  try { data = e.data ? e.data.json() : {}; } catch (_) {}
  e.waitUntil(self.registration.showNotification(data.title || 'BrainStorm', {
    body: data.body || 'New message',
    icon: '/icons/app-icon-192.png',
    badge: '/icons/app-icon-192.png',
    data: { url: data.url || '/' }
  }));
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(self.clients.openWindow(e.notification.data.url || '/'));
});
