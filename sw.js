// ╔══════════════════════════════════════════════════════════════╗
// ║  HytaleHub — Service Worker PWA v3                          ║
// ║  Cache-first pour l'app shell, Network-only pour les APIs   ║
// ╚══════════════════════════════════════════════════════════════╝

const CACHE_APP   = 'hytalehub-app-v3';
const CACHE_FONTS = 'hytalehub-fonts-v1';

const PRECACHE = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

// ── Install ──────────────────────────────────────────────────────────────────
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_APP)
      .then(cache => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting())
  );
});

// ── Activate : supprime les anciens caches ───────────────────────────────────
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE_APP && k !== CACHE_FONTS)
            .map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

// ── Fetch : stratégie par domaine ────────────────────────────────────────────
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // 1. APIs sensibles → toujours réseau (jamais en cache)
  if (
    url.hostname.includes('supabase.co') ||
    url.hostname.includes('anthropic.com') ||
    url.hostname.includes('openai.com') ||
    url.hostname.includes('googleapis.com') && url.pathname.includes('/oauth')
  ) {
    e.respondWith(fetch(e.request));
    return;
  }

  // 2. Google Fonts CSS + fichiers woff2 → Cache First, TTL long
  if (url.hostname.includes('fonts.googleapis.com') || url.hostname.includes('fonts.gstatic.com')) {
    e.respondWith(
      caches.open(CACHE_FONTS).then(cache =>
        cache.match(e.request).then(cached => {
          if (cached) return cached;
          return fetch(e.request).then(res => {
            if (res.ok) cache.put(e.request, res.clone());
            return res;
          }).catch(() => cached);
        })
      )
    );
    return;
  }

  // 3. App shell (index.html, icônes, manifest) → Cache First + revalidate en fond
  e.respondWith(
    caches.open(CACHE_APP).then(cache =>
      cache.match(e.request).then(cached => {
        const fetchPromise = fetch(e.request).then(res => {
          if (res && res.status === 200 && res.type !== 'opaque') {
            cache.put(e.request, res.clone());
          }
          return res;
        }).catch(() => null);

        // Stale-while-revalidate : retourne le cache immédiatement, met à jour en fond
        return cached || fetchPromise.then(r => r || caches.match('/index.html'));
      })
    )
  );
});

// ── Background Sync (pour les futures fonctionnalités offline) ───────────────
self.addEventListener('sync', e => {
  if (e.tag === 'sync-user-data') {
    e.waitUntil(Promise.resolve());
  }
});

// ── Push Notifications ───────────────────────────────────────────────────────
self.addEventListener('push', e => {
  const data = e.data?.json() || { title: 'HytaleHub', body: 'Nouveau contenu disponible !' };
  e.waitUntil(
    self.registration.showNotification(data.title || 'HytaleHub', {
      body:    data.body || '',
      icon:    '/icons/icon-192.png',
      badge:   '/icons/icon-72.png',
      vibrate: [100, 50, 100],
      tag:     data.tag || 'hytalehub',
      data:    { url: data.url || '/' }
    })
  );
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(wins => {
      const target = e.notification.data?.url || '/';
      for (const w of wins) {
        if (w.url.includes(self.location.origin) && 'focus' in w) {
          w.navigate(target);
          return w.focus();
        }
      }
      return clients.openWindow(target);
    })
  );
});
