/* eslint-env serviceworker */
/**
 * Service worker — installability, and notifications that arrive with the app
 * closed.
 *
 * Two jobs, and deliberately no third:
 *
 *   1. Receive push messages and show them.
 *   2. Route a notification click back into the app.
 *
 * It caches the app SHELL only — icons, the manifest, the offline page. It
 * deliberately does NOT cache HTML pages or API responses. A portal whose
 * pages are served from a stale cache shows yesterday's attendance and last
 * week's documents, and the student has no way to tell. Every navigation and
 * every API call goes to the network; when the network is genuinely unavailable
 * the offline page says so honestly instead of lying with old data.
 */

'use strict';

const SHELL_CACHE = 'ten-shell-v3';
const SHELL_ASSETS = [
  '/offline.html',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/badge-72.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL_ASSETS))
      // A missing asset must not block installation, or push stops working
      // over one icon.
      .catch(() => {})
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k !== SHELL_CACHE).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

/**
 * Network first, always, for anything that is not a shell asset.
 *
 * The only thing served from the cache on a navigation is the offline page,
 * and only when the network actually failed.
 */
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  const isShellAsset = SHELL_ASSETS.indexOf(url.pathname) !== -1 ||
                       url.pathname.indexOf('/icons/') === 0;

  if (isShellAsset) {
    event.respondWith(
      caches.match(req).then((hit) => hit || fetch(req))
    );
    return;
  }

  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).catch(() => caches.match('/offline.html'))
    );
  }
  // Everything else — API calls, scripts, styles — falls through to the
  // network untouched. No caching, no staleness.
});

/**
 * A push arrived.
 *
 * The payload is encrypted end-to-end between the server and this browser; the
 * push service that relayed it could not read it.
 */
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (err) {
    data = { title: 'TEN Portal', body: event.data ? event.data.text() : '' };
  }

  const title = data.title || 'TEN Portal';
  const options = {
    body: data.body || '',
    icon: data.icon || '/icons/icon-192.png',
    badge: data.badge || '/icons/badge-72.png',
    // Same tag replaces rather than stacks: twenty messages from one person is
    // one line on the lock screen, not twenty.
    tag: data.tag || 'ten-notification',
    renotify: true,
    // The click destination travels with the notification. It is always a
    // same-origin path — the server refuses to put anything else here.
    data: { url: data.url || '/', at: data.at || Date.now() },
    timestamp: data.at || Date.now(),
    actions: [{ action: 'open', title: 'Open' }]
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

/**
 * The notification was tapped.
 *
 * If the portal is already open in a tab, focus it and navigate there rather
 * than opening a second copy — that is what every native app does, and two
 * tabs of the same conversation is its own annoyance.
 *
 * Whether the student ends up signed in is decided by the session cookie, not
 * here. There is deliberately no token in this URL: a notification URL is
 * written to the operating system's notification log and to browser history,
 * and a credential in either of those is readable by anyone holding the device.
 */
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const raw = (event.notification.data && event.notification.data.url) || '/';

  // Resolve, then check the origin — do not trust the string. "//evil.example/x"
  // begins with a slash yet resolves to another site, and this worker may be
  // handling a notification minted by an older build of the server. Anything
  // that does not land back on this origin goes to the home page instead.
  let absolute;
  try {
    const resolved = new URL(raw, self.location.origin);
    absolute = resolved.origin === self.location.origin ? resolved.href : self.location.origin + '/';
  } catch (err) {
    absolute = self.location.origin + '/';
  }

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        for (const client of clientList) {
          if (new URL(client.url).origin !== self.location.origin) continue;
          if ('focus' in client) {
            client.focus();
            if ('navigate' in client) return client.navigate(absolute);
            return client;
          }
        }
        if (self.clients.openWindow) return self.clients.openWindow(absolute);
        return null;
      })
  );
});

/**
 * Permission was revoked, or the subscription rotated.
 *
 * Re-subscribe with the same key and tell the server, otherwise notifications
 * stop silently and neither side knows why.
 */
self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil(
    fetch('/api/push/config')
      .then((r) => r.json())
      .then((cfg) => {
        if (!cfg.enabled || !cfg.publicKey) return null;
        return self.registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: cfg.publicKey
        });
      })
      .then((sub) => {
        if (!sub) return null;
        return fetch('/api/push/subscribe', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ subscription: sub })
        });
      })
      .catch(() => {})
  );
});
