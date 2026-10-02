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
const { hasMx } = require('./collegeDiscovery');
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
/**
 * Split a batch into who can be written to and who cannot.
 *
 * Exported because the PREVIEW calls it too. If the review pane counted
 * recipients its own way, it would promise a number the sender then quietly
 * fails to match — and the whole point of the review step is that what you
 * are shown is what goes out.
 *
 * A row whose domain has never been checked is checked once here and the
 * answer is written back, so this costs a resolver round trip the first time
 * a contact is considered and nothing afterwards.
 *
 * @returns {Promise<{sendable: object[], unroutable: Array<object & {reason: string}>}>}
 */
async function partitionByDeliverability(contacts) {
    const sendable = [];
    const unroutable = [];
    for (const c of contacts || []) {
        if (!c || !isSendableAddress(c.email)) {
            unroutable.push({ ...(c || {}), reason: 'malformed' });
            continue;
        }
        if (c.mxOk === true) { sendable.push(c); continue; }

        const ok = await hasMx(String(c.email).split('@')[1]);
        if (c._id) {
            await CollegeContact.updateOne(
                { _id: c._id }, { $set: { mxOk: ok, mxCheckedAt: new Date() } }
            ).catch(() => { /* the verdict is advisory; losing it costs one lookup */ });
        }
        if (ok) sendable.push({ ...c, mxOk: true });
        else unroutable.push({ ...c, reason: 'no-mx' });
    }
    return { sendable, unroutable };
}

/*
 * What the send in progress is doing.
 *
 * Same shape and the same reasoning as the agent's runStatus(): one process,
 * a run measured in minutes, and the only cost of losing it to a restart is
 * that the dashboard stops reporting. What must NOT be lost to a restart is
 * the work itself, and that lives in the database — see `queued` below.
 */
let currentSend = {
    running: false, startedAt: null, finishedAt: null,
    total: 0, sent: 0, failed: 0, skipped: 0,
    quotaStopped: false, interrupted: false, lastEmail: ''
};

/** A snapshot the dashboard can poll. */
function sendStatus() {
    return { ...currentSend };
}

/**
 * Send to a batch, durably.
 *
 * The bug this is shaped around: a batch of 187 at one mail every two seconds
 * is six and a quarter MINUTES of looping inside the node process. Anything
 * that restarts the process in that window — a deploy running `pm2 restart`,
 * which is exactly what merging a pull request does — killed the rest of the
 * batch silently. Thirteen mails went out, the dashboard said nothing, and
 * the remaining hundred and seventy-four simply never happened.
 *
 * So the batch is CLAIMED in the database before any of it is sent: every row
 * goes to `queued` in one update. From then on the queue is a fact on disk
 * rather than an array in memory.
 *
 *   crashes mid-batch  → rows stay `queued`, and resumeInterrupted() on the
 *                        next boot finishes them
 *   stops for quota    → the untouched rows go back to `new`, so they are
 *                        selectable again rather than stuck
 *   finishes           → nothing is left queued
 *
 * Double-sending is structurally impossible either way: sendOne() flips each
 * contact to `mailed` the moment its mail is accepted, so a row that was
 * already sent can never be picked up again.
 */
async function run(opts = {}) {
    // A bare number still means "a batch of that many", which is what the
    // original caller passed.
    const o = (typeof opts === 'number') ? { limit: opts } : (opts || {});
    const limit = Math.max(1, Math.min(500, o.limit || DEFAULT_BATCH));

    // One send at a time. Two overlapping loops would both throttle to two
    // seconds and together send one a second, which is the throttle gone.
    if (currentSend.running) return sendStatus();

    if (!o.resume) {
        /*
         * `ids` is the ticked selection from the dashboard. It narrows the
         * query and never replaces it: `optOut` and `status` still apply, so
         * ticking "select all" cannot mail somebody who asked to be left
         * alone, and cannot mail the same college twice.
         */
        const filter = { status: 'new', optOut: { $ne: true } };
        const ids = (o.ids || []).map(String).filter(Boolean);
        if (ids.length) filter._id = { $in: ids };

        const picked = await CollegeContact.find(filter).limit(limit).select('_id').lean();
        if (picked.length) {
            // Claim them. `status: 'new'` in the filter means a row another
            // request claimed a millisecond earlier is not claimed twice.
            await CollegeContact.updateMany(
                { _id: { $in: picked.map((p) => p._id) }, status: 'new' },
                { $set: { status: 'queued' } }
            );
        }
    }

    const found = await CollegeContact.find({ status: 'queued', optOut: { $ne: true } })
        .limit(limit).lean();

    /* Same rule the preview counted with, so the number shown before sending
       is the number sent. An address that cannot receive mail is skipped here
       rather than handed to the transport to bounce. */
    const { sendable: contacts, unroutable } = await partitionByDeliverability(found);

    currentSend = {
        running: true, startedAt: new Date(), finishedAt: null,
        total: contacts.length, sent: 0, failed: 0, skipped: unroutable.length,
        quotaStopped: false, interrupted: false, lastEmail: ''
    };

    let sent = 0, failed = 0, skipped = unroutable.length, quotaStopped = false;
    let stoppedAt = contacts.length;

    try {
        for (let i = 0; i < contacts.length; i++) {
            const contact = contacts[i];

            const { allowed } = await quota.canSend(1);
            if (!allowed) {
                skipped += contacts.length - i;
                quotaStopped = true;
                stoppedAt = i;
                break;
            }

            const result = await sendOne(contact);
            if (result === 'sent') sent++; else failed++;

            currentSend.sent = sent;
            currentSend.failed = failed;
            currentSend.lastEmail = contact.email || '';

            if (i < contacts.length - 1) await new Promise((r) => setTimeout(r, THROTTLE_MS));
        }
    } finally {
        /*
         * Hand back whatever this run did not send, so a batch stopped by the
         * quota leaves nothing stuck in `queued`. Only a run that DIES skips
         * this — which is precisely the signal resumeInterrupted() looks for.
         */
        const untouched = contacts.slice(stoppedAt).map((c) => c._id)
            .concat(unroutable.map((u) => u._id)).filter(Boolean);
        if (untouched.length) {
            await CollegeContact.updateMany(
                { _id: { $in: untouched }, status: 'queued' }, { $set: { status: 'new' } }
            ).catch(() => { /* they stay queued and the next boot finishes them */ });
        }
        currentSend.running = false;
        currentSend.finishedAt = new Date();
        currentSend.quotaStopped = quotaStopped;
        currentSend.skipped = skipped;
    }

    return { attempted: found.length, sent, failed, skipped,
             unroutable: unroutable.length, quotaStopped };
}

/**
 * Finish a batch the previous process died in the middle of.
 *
 * Called once at boot. Rows sitting in `queued` can only have got there one
 * way: a run claimed them and never came back. Sending them is finishing the
 * job the owner already asked for — and because each row flips to `mailed` as
 * its mail is accepted, nothing here can send the same mail twice.
 *
 * Set COLLEGE_RESUME_ON_BOOT=0 to leave them for a human to press Send on.
 */
async function resumeInterrupted() {
    if (String(process.env.COLLEGE_RESUME_ON_BOOT || '1') === '0') return { resumed: 0 };
    let waiting = 0;
    try {
        waiting = await CollegeContact.countDocuments({ status: 'queued', optOut: { $ne: true } });
    } catch (_) {
        return { resumed: 0 };   // no database yet; nothing to resume into
    }
    if (!waiting) return { resumed: 0 };

    console.log(`[college-outreach] ${waiting} mails were claimed by a run that did not `
              + 'finish — resuming.');
    run({ resume: true, limit: waiting }).catch((err) =>
        console.error('[college-outreach] resume failed:', err.message));
    return { resumed: waiting };
}

module.exports = { run, sendOne, buildHtml, unsubscribeUrl, partitionByDeliverability,
                   sendStatus, resumeInterrupted,
                   SUBJECT, THROTTLE_MS, DEFAULT_BATCH };
