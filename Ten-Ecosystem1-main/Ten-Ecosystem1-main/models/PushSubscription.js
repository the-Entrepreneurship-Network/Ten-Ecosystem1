'use strict';

/**
 * A browser's push endpoint — one row per device, per person.
 *
 * The endpoint URL is issued by the browser vendor's push service (FCM for
 * Chrome, Mozilla's autopush for Firefox, Apple's for Safari) and is what the
 * server posts to when it wants a notification delivered. The two keys are the
 * browser's half of the encryption: every payload is encrypted client-bound, so
 * the push service relays it without being able to read it.
 *
 * One person can have several rows — phone, laptop, work machine — and a
 * notification goes to all of them. Endpoints expire when the browser is
 * reinstalled or permission is revoked; the push service answers 404/410 for a
 * dead one, which is the signal to delete the row (see services/pushService).
 */

const mongoose = require('mongoose');

const pushSubscriptionSchema = new mongoose.Schema({
  // The chat/session identity: employeeId for students, email or username for
  // staff. Same id used everywhere else, so a notification can be addressed
  // without a second lookup.
  userId:   { type: String, required: true, index: true },
  role:     { type: String, default: '' },

  // Unique across the whole collection: the browser reissues the SAME endpoint
  // for a given installation, so re-subscribing must update the existing row
  // rather than accumulate duplicates and send the same notification twice.
  endpoint: { type: String, required: true, unique: true },

  keys: {
    p256dh: { type: String, required: true },
    auth:   { type: String, required: true }
  },

  // Purely diagnostic — which device is this, and is it still being used.
  userAgent:  { type: String, default: '' },
  lastSeenAt: { type: Date, default: Date.now },

  // Consecutive delivery failures. A subscription is removed on a definitive
  // rejection (404/410); this counts the softer errors so a persistently
  // unreachable endpoint can be cleaned up too.
  failureCount: { type: Number, default: 0 }
}, { timestamps: true });

pushSubscriptionSchema.index({ userId: 1, endpoint: 1 });

module.exports = mongoose.model('PushSubscription', pushSubscriptionSchema);
