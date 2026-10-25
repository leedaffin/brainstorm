// BrainStorm service worker: makes the app installable and quick to open.
// Pages are fetched fresh when online; the app shell is kept for offline starts.
const CACHE = 'brainstorm-shell-v130';
const SHELL = ['/', '/styles.css?v=82', '/app.js?v=117', '/config.js?v=124', '/supabase.min.js?v=2.45.4', '/icons/storm-hero.webp', '/icons/jungle-hero.webp?v=2', '/icons/wordmark.webp', '/icons/wordmark-600.webp', '/icons/neonwhite-hero.webp?v=3', '/icons/wordmark-light.webp?v=4', '/icons/wordmark-light-600.webp?v=4', '/icons/icon-nw-96.png?v=3', '/icons/icon-nw-64.webp?v=3', '/icons/icon-96.png', '/icons/logo-storm-192.png', '/icons/bg/storm-portrait.webp', '/icons/bg/storm-landscape.webp', '/icons/bg/neonwhite-portrait.webp', '/icons/bg/neonwhite-landscape.webp', '/icons/bg/jungle-portrait.webp', '/icons/bg/jungle-landscape.webp', '/icons/nursery-hero.webp?v=3', '/icons/logo-nursery-128.webp?v=1', '/icons/bg/nursery-portrait.webp?v=3', '/icons/bg/nursery-landscape.webp?v=3', '/icons/logo-neon-white-192.png', '/icons/logo-jungle-192.png', '/icons/icon-64.webp', '/icons/app-icon-192.png', '/icons/app-apple-touch-180.png', '/icons/favicon-32.png', '/icons/logo-storm-128.webp', '/icons/logo-neon-white-128.webp', '/icons/logo-jungle-128.webp', '/icons/mothership-96.webp', '/icons/moosehub-96.webp'];

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

// Push alerts: show who/where only (never the message), one notification per chat (newer replaces older)
self.addEventListener('push', (e) => {
  let data = {};
  try { data = e.data ? e.data.json() : {}; } catch (_) {}
  // Bump the app icon badge while the app is closed (the app sets the exact count when opened)
  let badge = self.__badge || 0;
  if (self.navigator && self.navigator.setAppBadge) { badge += 1; self.__badge = badge; self.navigator.setAppBadge(badge).catch(() => {}); }
  e.waitUntil(self.registration.showNotification(data.title || 'BrainStorm', {
    body: data.body || 'New message',
    icon: '/icons/app-icon-192.png',
    badge: '/icons/icon-96.png',
    tag: data.tag || undefined,
    renotify: !!data.tag,
    data: { url: data.url || '/' }
  }));
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || '/';
  const m = url.match(/#c=([0-9a-f-]{36})$/);
  // Leave a note for the app too: phones often wake the app without passing the message on
  const note = m ? caches.open('bs-nav').then((c) => c.put('/__open', new Response(JSON.stringify({ id: m[1], at: Date.now() })))).catch(() => {}) : Promise.resolve();
  e.waitUntil(note.then(() => self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    const w = list.find((c) => new URL(c.url).origin === self.location.origin);
    if (w) { if (m) w.postMessage({ open: m[1] }); return w.focus(); }
    return self.clients.openWindow(url);
  })));
});

// The app tells us the real unread total so push bumps start from the right number
self.addEventListener('message', (e) => {
  if (e.data && typeof e.data.badge === 'number') self.__badge = e.data.badge;
});
