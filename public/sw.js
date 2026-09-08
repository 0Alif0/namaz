/*
 * Namaz service worker (spec §26, §30, §31).
 *
 * Bump CACHE_VERSION on every deploy. The activate handler deletes every cache
 * that is not the current one, so a new version fully replaces the old.
 *
 * Plain JavaScript on purpose: it ships as-is from /public and needs no build
 * step, so what you read here is exactly what runs on the phone.
 */

const CACHE_VERSION = 'v1';
const CACHE_NAME = `namaz-${CACHE_VERSION}`;

/*
 * Everything is resolved against the worker's own scope rather than the domain
 * root, so the same file works at https://example.com/ and at
 * https://user.github.io/namaz/ with no changes.
 */
const SCOPE = new URL('./', self.registration.scope);
const at = (path) => new URL(path, SCOPE).toString();

const SHELL_INDEX = at('index.html');

/* The shell. Hashed build assets are added on first use by the fetch handler. */
const SHELL = [
  at('./'),
  SHELL_INDEX,
  at('manifest.webmanifest'),
  at('icons/icon-192.png'),
  at('icons/icon-512.png'),
  at('icons/apple-touch-icon.png'),
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(names.filter((name) => name !== CACHE_NAME).map((name) => caches.delete(name))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;

  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Never cache API traffic — a stale schedule is worse than no schedule.
  if (url.pathname.includes('/api/')) return;

  // Navigations: try the network so a new deploy is picked up, fall back to the
  // cached shell so the app opens offline.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(SHELL_INDEX, copy));
          return response;
        })
        .catch(() => caches.match(SHELL_INDEX).then((cached) => cached || Response.error())),
    );
    return;
  }

  // Everything else — the JS bundle carrying the prayer engine, CSS, icons — is
  // content-hashed by Vite, so cache-first is safe and makes offline reliable.
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;

      return fetch(request).then((response) => {
        if (response.ok && response.type === 'basic') {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        }
        return response;
      });
    }),
  );
});

self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch (error) {
    payload = {};
  }

  const title = payload.title || 'Namaz';
  const options = {
    body: payload.body || 'It is time for prayer.',
    icon: at('icons/icon-192.png'),
    badge: at('icons/icon-192.png'),
    tag: payload.tag || 'namaz-prayer',
    renotify: true,
    // No sound is set anywhere: reminders are notifications only (spec §2).
    data: { url: at('./') },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) return client.focus();
      }
      return self.clients.openWindow(at('./'));
    }),
  );
});
