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

const { createEmailTransporter, mailerReady, isSendableAddress, EMAIL_FROM } = require('../utils/mailer');

let transporter = null;
function getTransporter() {
    // Built on first use, not at require time: the module is pulled in from a
    // mongoose hook, and .env is loaded before any of that runs.
    if (!transporter) transporter = createEmailTransporter();
    return transporter;
}

const TYPE_COLOURS = {
    success: '#16a34a',
    warning: '#f59e0b',
    urgent: '#dc2626',
    info: '#2563eb'
};

function buildHTML(name, title, message, type) {
    const accent = TYPE_COLOURS[type] || TYPE_COLOURS.info;
    const esc = (s) => String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return `<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;padding:8px">
  <div style="border-left:4px solid ${accent};padding:20px 24px;background:#f8fafc;border-radius:6px">
    <h2 style="margin:0 0 12px;font-size:18px;color:#0f172a">${esc(title)}</h2>
    <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#334155">${esc(message)}</p>
    <a href="https://virtualinternships.entrepreneurshipnetwork.net/student-dashboard.html"
       style="display:inline-block;background:${accent};color:#fff;text-decoration:none;
              padding:10px 20px;border-radius:6px;font-size:14px">Open my portal</a>
  </div>
  <p style="margin:16px 0 0;font-size:12px;color:#94a3b8;text-align:center">
    Sent to ${esc(name || 'you')} by The Entrepreneurship Network because of activity on your internship account.
  </p>
</div>`;
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
