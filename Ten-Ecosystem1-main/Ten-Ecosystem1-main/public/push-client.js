/**
 * Registers the service worker, and manages the push subscription.
 *
 * Included on every signed-in page. It never asks for notification permission
 * on its own — a permission prompt on page load is the fastest way to get
 * "Block" clicked, and once blocked the browser will not ask again. The user
 * turns notifications on from the Notifications page, and this module does the
 * work when they do.
 */
(function () {
  'use strict';

  if (typeof window === 'undefined') return;
  if (window.__tenPushInstalled) return;
  window.__tenPushInstalled = true;

  var swReady = null;

  /** The VAPID key arrives base64url; PushManager wants a Uint8Array. */
  function urlBase64ToUint8Array(base64String) {
    var padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    var base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    var raw = window.atob(base64);
    var out = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  }

  function supported() {
    return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  }

  /**
   * Register the worker.
   *
   * Done on every page, permission or not: the worker is also what makes the
   * portal installable, and installability should not depend on someone having
   * agreed to notifications.
   */
  function register() {
    if (!('serviceWorker' in navigator)) return Promise.resolve(null);
    if (swReady) return swReady;
    swReady = navigator.serviceWorker.register('/sw.js', { scope: '/' })
      .then(function () { return navigator.serviceWorker.ready; })
      .catch(function (err) {
        console.warn('[push] service worker registration failed:', err && err.message);
        return null;
      });
    return swReady;
  }

  function config() {
    return fetch('/api/push/config', { credentials: 'same-origin' })
      .then(function (r) { return r.json(); })
      .catch(function () { return { enabled: false, publicKey: '' }; });
  }

  /** Current state, for the Notifications page to render honestly. */
  function status() {
    if (!supported()) {
      return Promise.resolve({ supported: false, permission: 'unsupported', subscribed: false });
    }
    return config().then(function (cfg) {
      if (!cfg.enabled) {
        return { supported: true, serverEnabled: false, permission: Notification.permission, subscribed: false };
      }
      return register().then(function (reg) {
        if (!reg) return { supported: true, serverEnabled: true, permission: Notification.permission, subscribed: false };
        return reg.pushManager.getSubscription().then(function (sub) {
          return {
            supported: true,
            serverEnabled: true,
            permission: Notification.permission,
            subscribed: !!sub
          };
        });
      });
    });
  }

  /**
   * Ask for permission and subscribe. Only ever called from a click.
   *
   * @returns {Promise<{ok:boolean, reason?:string}>}
   */
  function enable() {
    if (!supported()) {
      return Promise.resolve({ ok: false, reason: 'This browser cannot show push notifications.' });
    }
    return config().then(function (cfg) {
      if (!cfg.enabled || !cfg.publicKey) {
        return { ok: false, reason: 'Push notifications are not configured on the server yet.' };
      }
      return Notification.requestPermission().then(function (permission) {
        if (permission !== 'granted') {
          return {
            ok: false,
            reason: permission === 'denied'
              // Worth being specific: once blocked, the browser will not ask
              // again, and the user has to undo it in site settings.
              ? 'Notifications are blocked for this site. Turn them back on in your browser settings for this site, then try again.'
              : 'Notification permission was not granted.'
          };
        }
        return register().then(function (reg) {
          if (!reg) return { ok: false, reason: 'The service worker could not start.' };
          return reg.pushManager.subscribe({
            userVisibleOnly: true,   // required by Chrome: every push must show something
            applicationServerKey: urlBase64ToUint8Array(cfg.publicKey)
          }).then(function (sub) {
            return fetch('/api/push/subscribe', {
              method: 'POST',
              credentials: 'same-origin',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ subscription: sub })
            }).then(function (r) { return r.json(); })
              .then(function (d) {
                return d.success ? { ok: true } : { ok: false, reason: d.message || 'The server refused the subscription.' };
              });
          });
        });
      });
    }).catch(function (err) {
      return { ok: false, reason: err && err.message ? err.message : 'Could not enable notifications.' };
    });
  }

  function disable() {
    if (!supported()) return Promise.resolve({ ok: true });
    return register().then(function (reg) {
      if (!reg) return { ok: true };
      return reg.pushManager.getSubscription().then(function (sub) {
        if (!sub) return { ok: true };
        var endpoint = sub.endpoint;
        return sub.unsubscribe().then(function () {
          return fetch('/api/push/unsubscribe', {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ endpoint: endpoint })
          }).then(function () { return { ok: true }; });
        });
      });
    }).catch(function () { return { ok: true }; });
  }

  function test() {
    return fetch('/api/push/test', { method: 'POST', credentials: 'same-origin' })
      .then(function (r) { return r.json(); })
      .catch(function () { return { success: false }; });
  }

  /**
   * Keep the subscription fresh.
   *
   * A browser can drop or rotate a subscription silently. If permission is
   * still granted but there is no subscription, quietly make a new one — the
   * user already said yes, so there is no prompt and nothing to click.
   */
  function resubscribeIfNeeded() {
    if (!supported() || Notification.permission !== 'granted') return;
    status().then(function (s) {
      if (s.serverEnabled && !s.subscribed) enable();
    }).catch(function () {});
  }

  register().then(resubscribeIfNeeded);

  window.TenPush = {
    supported: supported,
    status: status,
    enable: enable,
    disable: disable,
    test: test
  };
})();
