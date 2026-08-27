'use strict';

/**
 * "HR needs to look at this."
 *
 * Two queues now wait on a human: proctoring incidents from the exam room, and
 * fee-deferral requests from the registration screen. Both have to reach HR the
 * same two ways — a notification inside the portal for whoever is logged in,
 * and a mail to the HR list for whoever is not — and neither may take the
 * request down with it if the mailer is having a bad day.
 *
 * ponytail: there is no HR *level* anywhere in the data — no field, no roles
 * table, nothing to filter on — so "level 4" and "level 6" both mean every HR
 * account plus HR_NOTIFY_EMAIL. Add a `level` to models/HR.js and this is a
 * one-line filter on the find().
 */

/**
 * Never throws. Both halves are attempted independently.
 * @param {{title: string, message: string, link: string, subject: string, bodyHtml: string, ctaLabel?: string}} alert
 */
async function alertHR(alert) {
    try {
        const HR = require('../models/HR');
        const EcosystemNotification = require('../models/EcosystemNotification');
        const hrUsers = await HR.find({}).select('_id').lean();
        if (hrUsers.length) {
            await EcosystemNotification.insertMany(hrUsers.map((h) => ({
                userId: h._id,
                type: 'system_announcement',
                title: alert.title,
                message: alert.message,
                link: alert.link,
                data: alert.data || {}
            })));
        }
    } catch (err) {
        console.error('[hrAlert] notification failed:', err.message);
    }

    try {
        const {
            createEmailTransporter, mailerReady, renderEmail,
            EMAIL_FROM, HR_NOTIFY_EMAIL, PORTAL_URL
        } = require('../utils/mailer');
        if (!mailerReady()) return;
        await createEmailTransporter().sendMail({
            from: EMAIL_FROM,
            to: HR_NOTIFY_EMAIL,
            subject: alert.subject,
            html: renderEmail({
                heading: alert.title,
                bodyHtml: alert.bodyHtml,
                cta: { label: alert.ctaLabel || 'Open the queue', url: PORTAL_URL + alert.link },
                footerWhy: 'You are receiving this because you are on the TEN HR notification list.'
            })
        });
    } catch (err) {
        console.error('[hrAlert] mail failed:', err.message);
    }
}

module.exports = { alertHR };
