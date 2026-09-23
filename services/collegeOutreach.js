'use strict';

/**
 * Mailing the placement offices discovery found.
 *
 * WHY THIS IS NOT growthSender
 *
 * growthSender mails students, and three things in it are student-shaped: the
 * unsubscribe link writes to the Student collection, the open and click pixels
 * record ids onto a GrowthCampaign's student arrays, and the footer says "you
 * registered for a TEN internship". Pointing any of that at a college would
 * either corrupt a campaign's numbers or tell an institution something untrue.
 * So this is its own loop — but it shares the two things that matter:
 * `growthQuota.canSend` and a MailHistory row, which is what keeps college
 * mail inside the same monthly ceiling as everything else rather than quietly
 * doubling the bill.
 *
 * There is no per-campaign content here on purpose. The pitch to a placement
 * officer does not change week to week, so a campaign builder for it would be
 * scaffolding for an edit nobody makes.
 */

const {
    createEmailTransporter, renderEmail, escapeHtml, isSendableAddress, EMAIL_FROM, PORTAL_URL
} = require('../utils/mailer');
const MailHistory = require('../models/MailHistory');
const CollegeContact = require('../models/CollegeContact');
const quota = require('./growthQuota');
const tracking = require('./growthTracking');

/** Same throttle as every other bulk send in this app. */
const THROTTLE_MS = parseInt(process.env.GROWTH_SEND_THROTTLE_MS, 10) || 2000;

/** What one run will send at most, so a mistake costs a batch and not a month. */
const DEFAULT_BATCH = parseInt(process.env.COLLEGE_BATCH_SIZE, 10) || 100;

const BASE = String(PORTAL_URL || '').replace(/\/+$/, '');

let transporter = null;
function getTransporter() {
    if (!transporter) transporter = createEmailTransporter({ pool: true });
    return transporter;
}

/** The college's own unsubscribe link — a different kind, a different route. */
const unsubscribeUrl = (id) => `${BASE}/g/cu/${id}/${tracking.sign('cu', id)}`;

const WHAT_WE_OFFER = [
    ['Structured internships', 'Six weeks, a coordinator, weekly tasks, attendance that counts — not a certificate mill.'],
    ['A verifiable certificate', 'Every certificate carries a serial your office can check against our records.'],
    ['No cost to the institution', 'We do not charge the college, and we do not ask for a placement fee.'],
    ['One point of contact', 'You get a named coordinator for your students, and a roster you can see.']
];

function offerHtml() {
    const rows = WHAT_WE_OFFER.map(([title, line]) =>
        `<tr><td style="padding:0 0 13px;">
           <span style="color:#f5c542;font-weight:700;">${escapeHtml(title)}</span>
           <span style="color:#8b8578;"> — </span>
           <span style="color:#e8e5dd;">${escapeHtml(line)}</span>
         </td></tr>`).join('');
    return `<table width="100%" cellspacing="0" cellpadding="0" style="font-size:14px;line-height:1.6;">${rows}</table>`;
}

const SUBJECT = 'Internships for your students — The Entrepreneurship Network';

/** The mail for one college. */
function buildHtml(contact) {
    const who = contact.college ? escapeHtml(contact.college) : 'your college';
    return renderEmail({
        heading: 'Internships for your students',
        name: contact.contactName || '',
        bodyHtml:
            `<p style="margin:0 0 14px;">I am writing to the placement office at ${who}. The Entrepreneurship
             Network runs structured remote internships for undergraduates — software, design, business and
             data — and we work with placement cells directly rather than advertising to students one by one.</p>
             <p style="margin:0 0 14px;">If it is useful, we can send a one-page brief you can circulate,
             or set up a short call to walk your team through how the programme runs.</p>`,
        panel: { label: 'WHAT WE RUN', html: offerHtml() },
        cta: { label: 'See the programme →', url: BASE + '/overview' },
        note: `Not the right person here? <a href="${unsubscribeUrl(contact._id)}" style="color:#cdb24a;">Remove this address</a> and we will not write again.`,
        footerWhy: 'You are receiving this because your institution publishes this address as its placement contact.'
    });
}

/** Send one and record it. Returns 'sent' | 'failed'. */
async function sendOne(contact) {
    let status = 'sent';
    let error = '';
    try {
        await getTransporter().sendMail({
            from: EMAIL_FROM,
            to: contact.email,
            subject: SUBJECT,
            html: buildHtml(contact)
        });
    } catch (err) {
        status = 'failed';
        error = (err && err.message) ? String(err.message).slice(0, 400) : 'unknown error';
    }

    try {
        await MailHistory.create({
            recipientEmail: contact.email,
            recipientName: contact.contactName || contact.college || '',
            subject: SUBJECT,
            // This string is in growthQuota's MARKETING_TYPES, which is what
            // makes a college mail count against the same monthly allowance.
            mailType: 'college-outreach',
            sentAt: new Date(),
            status,
            errorMessage: error
        });
    } catch (_) { /* the mail went out; a missing log row must not stop the run */ }

    try {
        await CollegeContact.updateOne({ _id: contact._id }, {
            $set: {
                status: status === 'sent' ? 'mailed' : 'bounced',
                lastMailedAt: new Date(),
                lastError: error
            },
            $inc: { mailCount: 1 }
        });
    } catch (_) {}

    return status;
}

/**
 * Mail up to `limit` colleges that have not been written to yet.
 *
 * The quota is re-checked before every message for the same reason the student
 * sender does it: the Monday cron may be running at the same time, and a check
 * from five minutes ago knows nothing about what it has sent since.
 */
async function run(opts = {}) {
    // A bare number still means "a batch of that many", which is what the
    // original caller passed.
    const o = (typeof opts === 'number') ? { limit: opts } : (opts || {});
    const limit = Math.max(1, Math.min(500, o.limit || DEFAULT_BATCH));

    /*
     * `ids` is the ticked selection from the dashboard. It narrows the query
     * and never replaces it: `optOut` and `status` still apply, so ticking
     * "select all" cannot mail somebody who asked to be left alone, and cannot
     * mail the same college twice.
     */
    const filter = { status: 'new', optOut: { $ne: true } };
    const ids = (o.ids || []).map(String).filter(Boolean);
    if (ids.length) filter._id = { $in: ids };

    const contacts = await CollegeContact.find(filter).limit(limit).lean();

    let sent = 0, failed = 0, skipped = 0, quotaStopped = false;

    for (let i = 0; i < contacts.length; i++) {
        const contact = contacts[i];
        if (!isSendableAddress(contact.email)) { skipped++; continue; }

        const { allowed } = await quota.canSend(1);
        if (!allowed) {
            skipped += contacts.length - i;
            quotaStopped = true;
            break;
        }

        const result = await sendOne(contact);
        if (result === 'sent') sent++; else failed++;

        if (i < contacts.length - 1) await new Promise((r) => setTimeout(r, THROTTLE_MS));
    }

    return { attempted: contacts.length, sent, failed, skipped, quotaStopped };
}

module.exports = { run, sendOne, buildHtml, unsubscribeUrl, SUBJECT, THROTTLE_MS, DEFAULT_BATCH };
