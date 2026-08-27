'use strict';

/**
 * The mail somebody gets when they drop their address into the Career Studio.
 *
 * The box on that page did nothing at all: the submit handler set a flag that
 * changed the wording to "You're on the list", and no request was made, no
 * record was written and no mail was sent. Every person who typed their
 * address in was told they had joined something that did not exist.
 *
 * What they get now is one mail that says what is actually on the other side
 * of the link, and the link goes back to the page they were already on — the
 * Studio is the front door to all of it.
 */

const {
    createEmailTransporter, mailerReady, isSendableAddress,
    renderEmail, escapeHtml, PORTAL_URL, EMAIL_FROM
} = require('../utils/mailer');

/* The mail's one link. It lands on the overview page — the full walkthrough of
 * what each part does for an intern — because the mail is a sign-up
 * confirmation, and the page after a sign-up should explain, not re-sell. */
const OVERVIEW_URL = PORTAL_URL.replace(/\/+$/, '') + '/overview';

/** What the Studio actually contains, in the order it is worth reading. */
const WHAT_YOU_GET = [
    ['Learn',        'A six-week curriculum in your domain — videos, quizzes, assignments and a project that gets reviewed.'],
    ['Intern',       'A real internship with a coordinator, weekly tasks and attendance that counts towards your certificate.'],
    ['Get hired',    'An agent that hunts live openings across the web and applies on your behalf.'],
    ['Be ready',     'A resume rebuilt to pass an ATS, then checked line by line against the job you actually want.'],
    ['Compete',      'Hackathons and ideathons — 48 hours, one repo, a demo that has to run.'],
    ['Be guided',    'Mentor sessions with people who have already done the thing you are trying to do.']
];

function eligibilityHtml() {
    const rows = WHAT_YOU_GET.map(([title, line]) =>
        `<tr><td style="padding:0 0 13px;">
           <span style="color:#f5c542;font-weight:700;">${escapeHtml(title)}</span>
           <span style="color:#8b8578;"> — </span>
           <span style="color:#e8e5dd;">${escapeHtml(line)}</span>
         </td></tr>`).join('');
    return `<table width="100%" cellspacing="0" cellpadding="0" style="font-size:14px;line-height:1.6;">${rows}</table>`;
}

/**
 * Send it. Never throws — a marketing mail that fails must not turn into a
 * 500 on a form somebody just filled in.
 *
 * @returns {Promise<{status: 'sent'|'failed'|'skipped', error: string}>}
 */
async function sendEligibilityMail(email) {
    if (!mailerReady()) return { status: 'skipped', error: 'mail not configured' };
    if (!isSendableAddress(email)) return { status: 'skipped', error: 'not a sendable address' };

    const html = renderEmail({
        heading: "You're eligible",
        bodyHtml:
            `<p style="margin:0 0 14px;">Your sign-up for the TEN Academic Portal is in. Here is the whole of
             what opens up — and the button below walks you through every piece,
             then takes you to your registration.</p>`,
        panel: { label: 'WHAT IS INSIDE', html: eligibilityHtml() },
        cta: { label: 'See your full journey →', url: OVERVIEW_URL },
        note: 'One place, one login. Nothing here needs a different account.',
        // They have no account — the default line would be a lie to a stranger.
        footerWhy: 'You are receiving this because you asked about the TEN Career Studio.'
    });

    try {
        await createEmailTransporter().sendMail({
            from: EMAIL_FROM,
            to: email,
            subject: "You're eligible — learning, an internship, and the job at the end of it",
            html
        });
        console.log('[Studio] ✓ eligibility mail sent to', email);
        return { status: 'sent', error: '' };
    } catch (err) {
        const message = (err && err.message) || String(err);
        console.error('[Studio] eligibility mail failed for', email, '—', message);
        return { status: 'failed', error: message };
    }
}

/**
 * Take an address from the Studio page: record it, and mail them once.
 *
 * The reply is deliberately the same whether this address is new, already on
 * the list, or refused by the mailer. This endpoint is public and unauthenticated,
 * so an answer that differed would turn it into a way to ask "is this person
 * signed up?" about anybody.
 *
 * @returns {Promise<{ok: boolean, fresh: boolean, mail: string}>}
 */
async function captureLead(rawEmail, meta = {}) {
    const email = String(rawEmail || '').trim().toLowerCase();
    // Shape only. Deciding whether a real mailbox exists is the mailer's job.
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || email.length > 254) {
        return { ok: false, fresh: false, mail: 'invalid' };
    }

    const StudioLead = require('../models/StudioLead');

    let existing = null;
    try {
        existing = await StudioLead.findOne({ email }).select('_id').lean();
    } catch (err) {
        // A database that cannot be read must not stop the mail. The worst case
        // is a second copy, which is better than the silence this replaces.
        console.error('[Studio] lead lookup failed:', err.message);
    }
    if (existing) return { ok: true, fresh: false, mail: 'already' };

    const result = await sendEligibilityMail(email);

    try {
        await StudioLead.create({
            email,
            source: meta.source || 'student-portal',
            referrer: String(meta.referrer || '').slice(0, 300),
            mailStatus: result.status,
            mailError: result.error.slice(0, 300),
            mailedAt: new Date()
        });
    } catch (err) {
        // A duplicate key here means two requests raced. Both are fine; the
        // index is what stopped the second mail from ever being a third.
        if (!/duplicate key/i.test(err.message || '')) {
            console.error('[Studio] could not record lead:', err.message);
        }
    }

    return { ok: true, fresh: true, mail: result.status };
}

module.exports = { captureLead, sendEligibilityMail, WHAT_YOU_GET, OVERVIEW_URL };
