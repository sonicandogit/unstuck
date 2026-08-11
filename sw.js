// Pretexto Service Worker v6
// Strategy: network-first for HTML (always fresh app), cache-first for CDN assets
//
// v6 (10 ago 2026): sube de v5 a v6 para forzar el borrado de la caché
// antigua. Motivo: babel-standalone y jszip se guardaron en su día como
// respuestas "opacas" (modo no-cors, sin crossorigin). Al añadir
// crossorigin="anonymous" a los 4 scripts de CDN en index.html (necesario
// para el hash de integridad SRI), esas dos URLs concretas — que no
// cambiaron de versión, a diferencia de dompurify/supabase-js — seguían
// sirviendo su copia vieja en caché, ahora inconsistente con el nuevo modo
// "cors" de la petición. Subir la versión limpia esa caché vieja entera;
// las nuevas entradas se guardarán ya correctamente en modo "cors" desde
// el principio.
//
// Además, en esta misma revisión: (1) SAST-009, solo se cachea la
// respuesta HTML si es válida (res.ok); (2) se ignoran peticiones con
// esquemas que no sean http/https (chrome-extension://, etc. — provienen
// de extensiones del navegador, no de la app, y la Cache API no las admite
// y lanzaba un error sin capturar).

const CACHE = 'pretexto-v6';
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

  // Bug encontrado al probar con extensiones del navegador activas (p.ej.
  // Grammarly): algunas hacen peticiones con esquemas como
  // "chrome-extension://", que la Cache API no admite en absoluto — un
  // intento de guardarlas lanzaba "TypeError: Failed to execute 'put' on
  // 'Cache': Request scheme 'chrome-extension' is unsupported". Se ignoran
  // aquí, antes de que lleguen a ninguna de las ramas de más abajo — no son
  // peticiones de la propia app, no hay nada que cachear ni que servir.
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return; // browser default
  }

  // Never touch Supabase / API / analytics calls
  if (url.hostname.includes('supabase.co') || url.hostname.includes('anthropic.com') || url.hostname.includes('google-analytics') || url.hostname.includes('googletagmanager')) {
    return; // browser default
  }

  // HTML: network-first (updates arrive immediately), cache fallback for offline
  if (e.request.mode === 'navigate' || (e.request.headers.get('accept') || '').includes('text/html')) {
    e.respondWith(
      fetch(e.request)
        .then(res => {
          // SAST-009: solo se cachea si la respuesta es válida (200-299). Antes
          // se guardaba cualquier respuesta, incluida una página de error de
          // GitHub Pages o un portal cautivo de wifi pública — y esa versión
          // rota se serviría después en modo offline.
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then(c => c.put(e.request, copy));
          }
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
    icon: '/pretexto-notification-icon.png',
    badge: '/pretexto-notification-icon.png',
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
