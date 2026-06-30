// Pretexto Service Worker v5
// Strategy: network-first for HTML (always fresh app), cache-first for CDN assets

const CACHE = 'pretexto-v5';
const CDN_HOSTS = [
  'unpkg.com',
  'cdn.jsdelivr.net',
  'cdnjs.cloudflare.com',
  'fonts.googleapis.com',
  'fonts.gstatic.com',
];

self.addEventListener('install', (e) => {
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);

  // Never touch Supabase / API / analytics calls
  if (url.hostname.includes('supabase.co') || url.hostname.includes('anthropic.com') || url.hostname.includes('google-analytics') || url.hostname.includes('googletagmanager')) {
    return; // browser default
  }

  // HTML: network-first (updates arrive immediately), cache fallback for offline
  if (e.request.mode === 'navigate' || (e.request.headers.get('accept') || '').includes('text/html')) {
    e.respondWith(
      fetch(e.request)
        .then(res => {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, copy));
          return res;
        })
        .catch(() => caches.match(e.request))
    );
    return;
  }

  // CDN assets (React, Babel, fonts...): cache-first, versioned and immutable
  if (CDN_HOSTS.some(host => url.hostname.includes(host))) {
    e.respondWith(
      caches.match(e.request).then(cached =>
        cached || fetch(e.request).then(res => {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, copy));
          return res;
        })
      )
    );
    return;
  }

  // Everything else (icons, manifest): stale-while-revalidate
  e.respondWith(
    caches.match(e.request).then(cached => {
      const fresh = fetch(e.request).then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy));
        return res;
      }).catch(() => cached);
      return cached || fresh;
    })
  );
});

// ─── PUSH NOTIFICATIONS ──────────────────────────────────────────
// Recibe el push enviado desde la Edge Function (send-push) y lo muestra
// como notificación del sistema, aunque la app esté cerrada.
self.addEventListener('push', (e) => {
  let data = {};
  try { data = e.data ? e.data.json() : {}; } catch (err) { data = {}; }

  const title = data.title || 'Pretexto';
  const options = {
    body: data.body || '',
    icon: '/unstuckfavicon.png',
    badge: '/unstuckfavicon.png',
    data: { type: data.type, entity_id: data.entity_id },
    tag: data.type || 'pretexto-notification', // agrupa notificaciones del mismo tipo
  };

  e.waitUntil(self.registration.showNotification(title, options));
});

// Al pulsar la notificación: si ya hay una pestaña de Pretexto abierta, la
// enfoca; si no, abre una nueva.
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientsArr) => {
      const existing = clientsArr.find((c) => c.url.includes(self.registration.scope));
      if (existing) return existing.focus();
      return self.clients.openWindow('/');
    })
  );
});
