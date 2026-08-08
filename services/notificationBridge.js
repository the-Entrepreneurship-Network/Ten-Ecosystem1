'use strict';

/**
 * @fileoverview Single place every part of the app should call to send a
 * notification, instead of constructing `new Notification({...})` directly.
 *
 * Writes to EcosystemNotification (the source of truth going forward). If
 * `legacy` targeting info is also passed, mirrors the same event into the
 * OLD Notification collection too, so anything still depending on the old
 * SSE/polling path during the migration window keeps working. Once every
 * portal page is confirmed running the new bell component, delete the
 * legacy-write block below (and, later, the old model + SSE code) — see
 * NOTIFICATIONS_PLAN.md §3.
 */

const EcosystemUser = require('../models/EcosystemUser');
const EcosystemNotification = require('../models/EcosystemNotification');

const CACHE_TTL_MS = 5 * 60 * 1000;
const emailCache = new Map(); // email -> { userId, cachedAt }

async function resolveEcosystemUserId(email) {
  if (!email) return null;
  const key = String(email).trim().toLowerCase();
  const hit = emailCache.get(key);
  if (hit && (Date.now() - hit.cachedAt) < CACHE_TTL_MS) return hit.userId;

  const doc = await EcosystemUser.findOne({ email: key }).select('_id').lean();
  if (!doc) return null;
  emailCache.set(key, { userId: doc._id, cachedAt: Date.now() });
  return doc._id;
}

/**
 * @param {Object} opts
 * @param {string} opts.email    - recipient's email (Student/Coordinator/HR/EcosystemUser)
 * @param {string} opts.type     - one of EcosystemNotification's type enum
 * @param {string} opts.title
 * @param {string} opts.message
 * @param {string} [opts.link]
 * @param {Object} [opts.legacy] - present only to also mirror into the old system during migration
 * @param {string} [opts.legacy.employeeId]
 * @param {string} [opts.legacy.domain]
 * @param {string} [opts.legacy.legacyType]  - old targetType value, e.g. "student"
 * @param {string} [opts.legacy.severity]    - old type value: info|warning|success|urgent
 * @param {string} [opts.legacy.from]
 */
async function notifyByEmail({ email, type, title, message, link = '', legacy = null }) {
  const result = { ecosystem: null, legacy: null };

  try {
    const userId = await resolveEcosystemUserId(email);
    if (userId) {
      result.ecosystem = await EcosystemNotification.create({ userId, type, title, message, link });
    } else {
      console.warn(
        '[notificationBridge] No EcosystemUser found for email:', email,
        '— skipping new-system notification. Has scripts/backfillEcosystemUsers.js been run?'
      );
    }
  } catch (err) {
    console.error('[notificationBridge] ecosystem write failed:', err.message);
  }

  if (legacy) {
    try {
      // Lazy require to avoid a hard dependency for callers that never pass `legacy`.
      const Notification = require('../models/Notification');
      result.legacy = await Notification.create({
        title,
        message,
        type: legacy.severity || 'info',
        from: legacy.from || 'System',
        targetType: legacy.legacyType || 'student',
        targetDomain: legacy.domain || '',
        targetEmployeeId: legacy.employeeId || '',
        targetUsername: legacy.username || ''
      });
    } catch (err) {
      console.error('[notificationBridge] legacy mirror write failed:', err.message);
    }
  }

  return result;
}

module.exports = { notifyByEmail, resolveEcosystemUserId };