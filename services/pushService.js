'use strict';

/**
 * Web push — a notification that reaches a student whose portal is closed.
 *
 * Everything in the portal already had a way to tell someone something, as long
 * as they were looking at it: SSE, Socket.IO, a bell that polls. None of that
 * survives closing the tab, which is exactly when a message is worth telling
 * someone about.
 *
 * The push flow, briefly:
 *
 *   1. The browser subscribes and hands back an endpoint URL owned by its
 *      vendor's push service, plus two keys.
 *   2. The server encrypts the payload with those keys and POSTs it to the
 *      endpoint, signing the request with the VAPID private key.
 *   3. The push service wakes the service worker on the device, which shows the
 *      notification. It cannot read the payload — the encryption is end-to-end
 *      between this server and that browser.
 *
 * VAPID keys are read from the environment and never committed. Without them
 * push is simply off: every function here degrades to a no-op and says so once
 * at boot, so the portal runs perfectly well with the feature disabled.
 */

const webpush = require('web-push');
const PushSubscription = require('../models/PushSubscription');

const PUBLIC_KEY  = process.env.VAPID_PUBLIC_KEY  || '';
const PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || '';
// mailto: for the push service to contact if this server misbehaves. Required
// by the VAPID spec; the address is not secret.
const CONTACT = process.env.VAPID_CONTACT || 'mailto:ten.hr.contact@gmail.com';

let enabled = false;

if (PUBLIC_KEY && PRIVATE_KEY) {
  try {
    webpush.setVapidDetails(CONTACT, PUBLIC_KEY, PRIVATE_KEY);
    enabled = true;
    console.log('[push] Web push enabled.');
  } catch (err) {
    // A malformed key is worth naming precisely: the usual cause is a shell
    // mangling the value, and "push silently does nothing" is a miserable thing
    // to debug from the outside.
    console.error('[push] VAPID keys are set but invalid — push is DISABLED:', err.message);
    console.error('[push] Regenerate with: node scripts/generate-vapid-keys.js');
  }
} else {
  console.log('[push] VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY not set — push notifications are off.');
}

/**
 * A click destination that cannot leave this site.
 *
 * Accepts a path beginning with a single "/" and nothing else — no absolute
 * URL, no scheme, and not the protocol-relative "//host/path" form, which is
 * the one that looks safe and is not.
 */
function safePath(value) {
  if (typeof value !== 'string') return '/';
  if (value.charAt(0) !== '/') return '/';
  if (value.charAt(1) === '/' || value.charAt(1) === '\\') return '/';
  return value;
}

/** Is push configured? The client asks before offering to enable notifications. */
function isEnabled() {
  return enabled;
}

/** The public key, safe to hand to any browser. The private one never leaves. */
function getPublicKey() {
  return enabled ? PUBLIC_KEY : '';
}

/**
 * Record (or refresh) a browser's subscription.
 *
 * Keyed on the endpoint, because the browser reissues the same one for a given
 * installation — an insert per call would send every notification twice, then
 * three times.
 */
async function saveSubscription(userId, role, subscription, userAgent) {
  if (!subscription || !subscription.endpoint || !subscription.keys) {
    throw new Error('A push subscription needs an endpoint and keys.');
  }
  return PushSubscription.findOneAndUpdate(
    { endpoint: subscription.endpoint },
    {
      $set: {
        userId,
        role: role || '',
        endpoint: subscription.endpoint,
        keys: { p256dh: subscription.keys.p256dh, auth: subscription.keys.auth },
        userAgent: String(userAgent || '').slice(0, 300),
        lastSeenAt: new Date(),
        failureCount: 0
      }
    },
    { upsert: true, new: true }
  );
}

async function removeSubscription(endpoint) {
  if (!endpoint) return 0;
  const res = await PushSubscription.deleteOne({ endpoint });
  return res.deletedCount || 0;
}

/**
 * Send one notification to every device a person has registered.
 *
 * Never throws. A notification that cannot be delivered must not take down the
 * thing that triggered it — a chat message still sends whether or not the push
 * gets through.
 *
 * @param {string} userId  employeeId, email or username
 * @param {Object} payload { title, body, url, tag, icon }
 * @returns {Promise<{sent:number, removed:number, failed:number}>}
 */
async function sendToUser(userId, payload) {
  const result = { sent: 0, removed: 0, failed: 0 };
  if (!enabled || !userId) return result;

  let subs = [];
  try {
    subs = await PushSubscription.find({ userId }).lean();
  } catch (err) {
    console.error('[push] could not load subscriptions:', err.message);
    return result;
  }
  if (!subs.length) return result;

  const body = JSON.stringify({
    title: String(payload.title || 'TEN Portal').slice(0, 120),
    body:  String(payload.body  || '').slice(0, 300),
    // Where the notification click should land.
    //
    // Same-origin path only. A notification is a link the user has been trained
    // to trust, so an attacker-supplied destination abuses exactly that trust.
    // Note the second character: "//evil.example/x" begins with a slash but is
    // protocol-relative and resolves to a DIFFERENT ORIGIN, so a bare
    // startsWith('/') check lets an open redirect straight onto a lock screen.
    url:   safePath(payload.url),
    // Notifications sharing a tag replace each other, so twenty messages from
    // the same person are one line on the lock screen rather than twenty.
    tag:   String(payload.tag || 'ten-notification').slice(0, 80),
    icon:  '/icons/icon-192.png',
    badge: '/icons/badge-72.png',
    at:    Date.now()
  });

  await Promise.all(subs.map(async (sub) => {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: sub.keys },
        body,
        { TTL: 24 * 60 * 60 }   // the push service holds it for a day if the device is offline
      );
      result.sent++;
    } catch (err) {
      const status = err && err.statusCode;
      // 404/410 mean the endpoint is gone for good — the browser was
      // reinstalled, or the user revoked permission. Keeping the row would mean
      // retrying a dead address forever.
      if (status === 404 || status === 410) {
        await PushSubscription.deleteOne({ endpoint: sub.endpoint }).catch(() => {});
        result.removed++;
      } else {
        result.failed++;
        await PushSubscription.updateOne(
          { endpoint: sub.endpoint },
          { $inc: { failureCount: 1 } }
        ).catch(() => {});
        console.warn('[push] delivery failed (' + status + '):', err.message);
      }
    }
  }));

  return result;
}

/** Same notification to several people. Used for domain and broadcast notices. */
async function sendToMany(userIds, payload) {
  const totals = { sent: 0, removed: 0, failed: 0 };
  if (!enabled) return totals;
  const unique = Array.from(new Set((userIds || []).filter(Boolean)));
  for (const id of unique) {
    const r = await sendToUser(id, payload);
    totals.sent += r.sent; totals.removed += r.removed; totals.failed += r.failed;
  }
  return totals;
}

module.exports = {
  isEnabled,
  getPublicKey,
  saveSubscription,
  removeSubscription,
  sendToUser,
  sendToMany
};
