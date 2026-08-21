'use strict';

/**
 * Every personal notification also arrives as an email.
 *
 * The portal already had ~20 places that tell one student something happened —
 * payment approved, certificate issued, document verified, premium unlocked,
 * internship details changed. All of them ended at an in-app bell a student
 * only sees if they happen to log in.
 *
 * Rather than add a sendMail call to each of those twenty, this mirrors the
 * Notification itself: models/Notification.js calls mirror() from a post-save
 * hook, so every path that writes a student notification — the notifyStudent
 * static AND the two files that build `new Notification(...)` by hand — is
 * covered by one hook, and a notification added next year is covered without
 * anyone remembering to wire it up.
 *
 * Deliberately narrow in two ways:
 *
 *   targetType "student" only. A "domain" or "all" broadcast is one row that
 *   means hundreds of emails, which needs batching, throttling and an
 *   unsubscribe link before it is anything but a way to get the sending
 *   domain blocked. Those stay in-app.
 *
 *   Opt-out via doc.$locals.skipEmail, for the handful of events that already
 *   send their own, richer mail — a certificate issue mails the PDF and then
 *   raises a notification about it, and two emails for one event is worse than
 *   none.
 */

const { createEmailTransporter, mailerReady, isSendableAddress, renderEmail, escapeHtml, PORTAL_URL, EMAIL_FROM } = require('../utils/mailer');

let transporter = null;
function getTransporter() {
    // Built on first use, not at require time: the module is pulled in from a
    // mongoose hook, and .env is loaded before any of that runs.
    if (!transporter) transporter = createEmailTransporter();
    return transporter;
}

/*
 * The body. The shell — header, footer, button, widths — is renderEmail in
 * utils/mailer.js, shared with the offer letter, the certificates and the
 * welcome mail, so a student sees one identity rather than a different design
 * per event.
 */
const TYPE_HEADINGS = { success: '✅', warning: '⚠️', urgent: '🚨', info: '🔔' };

function buildHTML(name, title, message, type) {
    return renderEmail({
        heading: `${TYPE_HEADINGS[type] || TYPE_HEADINGS.info} ${title}`,
        name,
        bodyHtml: `<p style="margin:0;">${escapeHtml(message)}</p>`,
        cta: { label: 'Open my portal', url: PORTAL_URL + '/student-dashboard.html' }
    });
}

/**
 * Email one student their notification. Never throws and never rejects — a
 * notification that was saved must not be reported as failed because the mail
 * did not go out.
 *
 * @param {object} doc a saved Notification document
 * @returns {Promise<{sent: boolean, reason?: string}>}
 */
async function mirror(doc) {
    try {
        if (!doc) return { sent: false, reason: 'no document' };
        if (doc.$locals && doc.$locals.skipEmail) return { sent: false, reason: 'opted out' };
        if (doc.targetType !== 'student') return { sent: false, reason: 'not a personal notification' };
        if (!doc.targetEmployeeId) return { sent: false, reason: 'no recipient' };
        if (!mailerReady()) return { sent: false, reason: 'email not configured' };

        // The callers hand notifyStudent anything from a full Student document
        // to a bare { employeeId, domain }, so the address is looked up here
        // rather than trusted from the caller.
        const Student = require('../models/Student');
        const student = await Student.findOne({ employeeId: doc.targetEmployeeId })
            .select('email name fullName')
            .lean();
        const to = student && student.email;
        if (!isSendableAddress(to)) return { sent: false, reason: 'student has no usable email address' };

        await getTransporter().sendMail({
            from: EMAIL_FROM,
            to,
            subject: doc.title,
            html: buildHTML(student.name || student.fullName, doc.title, doc.message, doc.type),
            text: `${doc.title}\n\n${doc.message}\n\nOpen your portal: `
                + 'https://virtualinternships.entrepreneurshipnetwork.net/student-dashboard.html'
        });
        return { sent: true };
    } catch (err) {
        console.error('[notification-email] send failed:', err.message);
        return { sent: false, reason: err.message };
    }
}

module.exports = { mirror, buildHTML };
