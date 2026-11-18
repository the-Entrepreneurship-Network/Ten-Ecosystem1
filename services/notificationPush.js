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
            url:   LANDING
        });

        return { sent: result.sent > 0, devices: result.sent };
    } catch (err) {
        // A push must never delay or fail the notification that was already
        // saved, nor the email mirrored beside it.
        console.error('[notification-push] send failed:', err.message);
        return { sent: false, reason: err.message };
    }
}

module.exports = { mirror, LANDING };
