'use strict';

/**
 * Every personal notification is also pushed to the phone.
 *
 * The sibling of services/notificationEmail.js, hooked in the same place and
 * for the same reason: two files build `new Notification({ targetType:
 * "student" })` by hand and never call notifyStudent, so a hook on the static
 * would miss them — services/studentPropagation.js and
 * routes/v2/certificateApplications.js today, and whichever file does the same
 * next year. The model hook catches all of them, so a certificate issued, an
 * application approved and anything added later all reach the phone without
 * a push call being wired at each site.
 *
 * Nothing here is new transport. web-push, the service worker, the manifest
 * and the subscribe route were already in place and already carried chat
 * messages; this is the one funnel they were never connected to.
 */

/**
 * Where the notification's own push lands.
 *
 * The portal is installable, so a tap opens the app rather than a browser tab.
 * There is deliberately no credential in this URL — whether they arrive signed
 * in is decided by their session cookie, exactly as the chat push does it.
 */
const LANDING = '/notifications.html';

/**
 * @param {object} doc a saved Notification
 * @returns {Promise<{sent: boolean, reason?: string, devices?: number}>}
 */
async function mirror(doc) {
    try {
        if (!doc) return { sent: false, reason: 'no document' };
        // Mirrors skipEmail: an event that sends its own, better-aimed push
        // sets this so the generic one does not arrive beside it.
        if (doc.$locals && doc.$locals.skipPush) return { sent: false, reason: 'opted out' };
        // Personal only. A broadcast would wake every phone in the programme.
        if (doc.targetType !== 'student') return { sent: false, reason: 'not a personal notification' };
        if (!doc.targetEmployeeId) return { sent: false, reason: 'no recipient' };

        const push = require('./pushService');
        if (!push.isEnabled()) return { sent: false, reason: 'push not configured' };

        /*
         * No lookup: a student's push subscriptions are stored under their
         * employee ID (routes/push.js resolves `id` from the session as
         * `s.student.employeeId`), which is the same value the notification
         * already carries as targetEmployeeId. If those two ever diverge this
         * silently sends to nobody, so there is a test holding them together.
         */
        const result = await push.sendToUser(doc.targetEmployeeId, {
            title: doc.title,
            body:  doc.message,
            url:   LANDING,
            // Its own tag, as in any app: each update is its own line in the
            // phone's notification list, and Android counts them on the icon.
            // Under the shared default tag every update replaced the last.
            tag:   doc._id ? 'notification-' + doc._id : undefined
        });

        return { sent: result.sent > 0, devices: result.sent };
    } catch (err) {
        // A push must never delay or fail the notification that was already
        // saved, nor the email mirrored beside it.
        console.error('[notification-push] send failed:', err.message);
        return { sent: false, reason: err.message };
    }
}

/**
 * A founder's, mentor's, investor's or contractor's own notification
 * (models/EcosystemNotification.js) to their phone. Their subscriptions are
 * stored under their email, the id chat and the feed know them by
 * (services/chatIdentity.js), so one lookup turns the account id into it.
 *
 * @param {object} doc a saved EcosystemNotification
 * @returns {Promise<{sent: boolean, reason?: string, devices?: number}>}
 */
async function mirrorEcosystem(doc) {
    try {
        if (!doc || !(doc.$locals && doc.$locals.wasNew)) return { sent: false, reason: 'not new' };
        const push = require('./pushService');
        if (!push.isEnabled()) return { sent: false, reason: 'push not configured' };
        const user = await require('../models/EcosystemUser').findById(doc.userId).select('email').lean();
        const email = user && String(user.email || '').trim();
        if (!email) return { sent: false, reason: 'no recipient' };
        const result = await push.sendToUser(email, {
            title: doc.title,
            body:  doc.message,
            url:   doc.link || '/notifications',
            tag:   'notification-' + doc._id
        });
        return { sent: result.sent > 0, devices: result.sent };
    } catch (err) {
        console.error('[notification-push] ecosystem send failed:', err.message);
        return { sent: false, reason: err.message };
    }
}

module.exports = { mirror, mirrorEcosystem, LANDING };
