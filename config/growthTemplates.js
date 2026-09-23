'use strict';

/**
 * Campaigns worth sending, written out in full.
 *
 * Every campaign before this was typed from an empty box, which is why the
 * Monday mail went out for months saying "we miss you" and asking for nothing.
 * A good template is not a convenience — it is the difference between a mail
 * that has an offer in it and one that does not.
 *
 * These are STARTING POINTS. The dashboard drops them into the same editable
 * fields as anything hand-written, so the wording, the price and the deadline
 * are all still the sender's to change before it goes out. Nothing here sends
 * on its own.
 *
 * `ctaPath` is relative on purpose. The absolute link is built from PORTAL_URL
 * at serve time, so a template cannot hard-code a domain that later moves.
 */

const TEMPLATES = Object.freeze([
    {
        key: 'eligible',
        label: "You're eligible",
        description: 'The invitation. Best for students who registered but never started.',
        suggestedSegment: 'dormant14',
        subject: "You're eligible for the next TEN internship cohort",
        heading: "You're eligible to apply",
        bodyText:
            'Your profile on the TEN portal matches what we look for in the next cohort, so this is an '
            + 'invitation rather than an advertisement.\n\n'
            + 'The cohort runs for six weeks with a named coordinator, weekly tasks, and attendance that '
            + 'counts towards a verifiable certificate. Seats are limited and applications close soon.\n\n'
            + 'If you have already started, ignore this — your place is held.',
        ctaLabel: 'Claim my seat →',
        ctaPath: '/overview'
    },
    {
        key: 'studio',
        label: 'Career Studio offer',
        description: 'The upsell. ₹500 for the combo against ₹650 separately. Best for students on a free track.',
        suggestedSegment: 'freeTenure',
        subject: 'Your resume, rebuilt to pass an ATS — ₹500 this week',
        heading: 'Everything in one place, ₹500',
        bodyText:
            'Most resumes are rejected by software before a person reads them. The Career Studio rebuilds '
            + 'yours to get through that filter, then checks it line by line against the job you actually want.\n\n'
            + 'It comes with the job agent, which hunts live openings across the web and applies on your '
            + 'behalf — bought together it is ₹500, against ₹650 if you take them separately.\n\n'
            + 'Your internship and certificate are unaffected either way. This is an add-on, not a requirement.',
        ctaLabel: "See what's included",
        ctaPath: '/studio.html'
    },
    {
        key: 'lastcall',
        label: 'Last call / deadline',
        description: 'Short and urgent. Send two or three days before a real deadline — never a fake one.',
        suggestedSegment: 'dormant14',
        subject: 'Applications close Friday',
        heading: 'Last call for this cohort',
        bodyText:
            'This is the final reminder for the current cohort — applications close on Friday and the next '
            + 'intake is not for another six weeks.\n\n'
            + 'It takes about four minutes to complete. If now is not the right time, you can ignore this '
            + 'and we will write again when the next intake opens.',
        ctaLabel: 'Finish my application →',
        ctaPath: '/overview'
    },
    {
        key: 'certificate',
        label: 'Finish your certificate',
        description: 'For students who started and stalled. Points at what they have already earned.',
        suggestedSegment: 'dormant14',
        subject: 'Your certificate is still waiting',
        heading: "You're closer than you think",
        bodyText:
            'You started an internship with us and stopped partway. The work you have already done is still '
            + 'on your dashboard, and your certificate is still available — nothing has expired.\n\n'
            + 'Most people who come back finish within two weeks. Your coordinator can reset your schedule '
            + 'if the original dates no longer suit you.',
        ctaLabel: 'Open my dashboard',
        ctaPath: '/student-dashboard.html'
    }
]);

const byKey = (key) => TEMPLATES.find((t) => t.key === key) || null;

module.exports = { TEMPLATES, byKey };
