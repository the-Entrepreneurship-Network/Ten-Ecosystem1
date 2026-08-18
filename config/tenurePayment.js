'use strict';

/**
 * The single definition of the internship programme fee.
 *
 * Two incompatible implementations of this existed:
 *
 *   server.js `/api/tenure-payment/*`  wrote  purpose: "tenure_1month"
 *   routes/v2/payment.js `/tenure-*`   wrote  purpose: "TEN Internship Payment"
 *
 * and the admin approval queue (routes/adminPortal.js) matched only `/^tenure_/`.
 * A student who paid through the v2 route was therefore invisible both to the
 * status check the dashboard polls AND to the admin queue — permanently locked
 * out of their dashboard with no way for anyone to clear it.
 *
 * Both routes now use these helpers, and lookups accept the historical purpose
 * strings so payments made before this change still resolve.
 */

const { normalizeTenure, getTenureLabel } = require('../utils/tenure');

/**
 * Confirmed rule (task document, issue 6.2): the fee applies ONLY to the
 * 1 Week, 15 Days and 1 Month tracks. 45 Days, 3 Months and 6 Months are free,
 * and a student on one of those must never see a payment screen anywhere.
 */
const PAID_TENURES = {
    '1week':  2000,
    '15days': 1500,
    '1month': 1000
};

/** Students who registered before this date are exempt. */
const PAYMENT_CUTOFF_DATE = new Date('2026-07-09T00:00:00.000Z');

/** Canonical purpose for a tenure payment, e.g. "tenure_1month". */
function purposeFor(durationType) {
    return `tenure_${durationType}`;
}

/**
 * Every purpose string that has ever meant "internship programme fee", so a
 * lookup finds payments written by either of the old implementations.
 */
function allPurposesFor(durationType) {
    const purposes = ['TEN Internship Payment', 'tenure_payment'];
    if (durationType) {
        purposes.push(purposeFor(durationType));
        // Pre-normalisation values could contain a space.
        purposes.push(`tenure_${getTenureLabel(durationType).toLowerCase()}`);
    }
    return Array.from(new Set(purposes));
}

/**
 * Does this student owe a programme fee?
 * @returns {{required: boolean, durationType: string|null, amount: number, label: string}}
 */
function getFeeFor(student) {
    const durationType = normalizeTenure(student && student.tenure);
    const amount = (durationType && PAID_TENURES[durationType]) || 0;

    return {
        required: amount > 0,
        durationType,
        amount,
        // The tenure name ONLY. These labels used to read "1 Month Internship
        // Program", and the dashboard wrapped them in its own "Internship
        // Program" sentence — "the TEN 1 Month Internship Program Internship
        // Program". Screenshot 8.
        label: durationType ? getTenureLabel(durationType) : ''
    };
}

/** Is the student exempt because they registered before the cutoff? */
function isExempt(student) {
    if (!student) return false;
    if (student.isExistingStudent) return true;
    const created = student.createdAt ? new Date(student.createdAt) : null;
    return !!(created && !Number.isNaN(created.getTime()) && created < PAYMENT_CUTOFF_DATE);
}

/**
 * What each paid track actually includes.
 *
 * Until now the three paid tracks bought nothing a free 6-month student did not
 * already get — only a shorter calendar. A student comparing "₹2,000 for 1 Week"
 * against a free 3-month track had no reason to pay, and the ladder reads
 * backwards besides: the shortest track costs the most, so the dearest option
 * looks like the one with the least in it.
 *
 * So each track is a bundle, and this is the one place its contents are
 * defined — the payment screen renders from it and the grant on approval reads
 * from it, so the two can never drift apart and promise different things.
 *
 * Only `coins` and `certificate` are granted automatically by
 * services/tenureBenefits.js. Everything in `perks` is either one of those two
 * or something staff deliver by hand; nothing here claims an automatic unlock
 * the code does not actually perform.
 *
 * A certificate is included as its FEE being waived, not as a certificate
 * handed over — the student still has to finish the programme and meet the
 * eligibility bar. The wording on screen says exactly that.
 */
const CERTIFICATE_VALUES = { cert_expert: 100, cert_nano_degree: 1000, cert_fellowship: 2500 };
const CERTIFICATE_LABELS = {
    cert_expert:      'Expert Certificate',
    cert_nano_degree: 'Nano Degree',
    cert_fellowship:  'Fellowship Certificate'
};

/**
 * What a coin is worth in rupees.
 *
 * Not invented for the sales copy — it is the rate the marketplace itself
 * charges, and it is the same on every item there: 200 coins buys ₹100 off a
 * mentor session, 600 buys ₹300 off a Nano Degree, 1000 buys ₹500 off a
 * Fellowship (public/ten-extras.js, which also falls back to `maxCoins * 0.5`).
 * The payment screen prices coins at this rate so the saving it advertises is
 * one the student can actually go and realise.
 */
const COIN_RUPEE_VALUE = 0.5;

const TENURE_BENEFITS = {
    '1month': {
        name: 'Starter',
        tagline: 'The Nano Degree fee alone is what this track costs.',
        badge: '',
        coins: 500,
        certificate: 'cert_nano_degree',
        extras: [
            { label: 'Full portal — tasks, quizzes, projects, attendance', worth: 0 }
        ]
    },
    '15days': {
        name: 'Accelerate',
        tagline: 'The Fellowship fee alone is ₹1,000 more than this track costs.',
        badge: 'MOST POPULAR',
        coins: 1000,
        certificate: 'cert_fellowship',
        extras: [
            { label: 'Priority task review — under 6 hours', worth: 0 },
            { label: 'One 30-minute mentor session',         worth: 250 }
        ]
    },
    '1week': {
        name: 'Sprint',
        tagline: 'Everything we offer, in the shortest run we run.',
        badge: 'BEST VALUE',
        coins: 2000,
        certificate: 'cert_fellowship',
        extras: [
            { label: 'Priority task review — under 6 hours', worth: 0 },
            { label: 'One 45-minute mentor session',         worth: 500 },
            { label: 'Resume rebuilt and pushed to the Job Portal agent', worth: 0 }
        ]
    }
};

/**
 * The bundle for a track, with the totals the payment screen prints.
 *
 * The certificate and coin lines are built here rather than written out in the
 * table above, so the headline value can never claim something different from
 * what services/tenureBenefits.js actually grants — they read the same two
 * fields. `valueTotal` is summed from the perks for the same reason.
 *
 * @param {string|null} durationType a canonical key, e.g. "15days"
 * @returns {object|null} null when the track is free or unknown
 */
function getBenefitsFor(durationType) {
    const bundle = TENURE_BENEFITS[durationType];
    if (!bundle) return null;

    const price = PAID_TENURES[durationType] || 0;
    const certValue = CERTIFICATE_VALUES[bundle.certificate] || 0;
    const certLabel = CERTIFICATE_LABELS[bundle.certificate] || 'Certificate';
    const coinValue = Math.round(bundle.coins * COIN_RUPEE_VALUE);

    const perks = [
        // "Fee included", never "certificate awarded" — the student still has to
        // finish the programme and clear the eligibility bar to be issued one.
        { label: `${certLabel} fee included`, worth: certValue, granted: 'certificate' },
        { label: `${bundle.coins.toLocaleString('en-IN')} bonus coins in the marketplace`, worth: coinValue, granted: 'coins' },
        ...bundle.extras.map((e) => ({ ...e, granted: null }))
    ];

    const valueTotal = perks.reduce((sum, perk) => sum + (perk.worth || 0), 0);

    return {
        durationType,
        name: bundle.name,
        tagline: bundle.tagline,
        badge: bundle.badge,
        price,
        coins: bundle.coins,
        certificate: bundle.certificate,
        certificateLabel: certLabel,
        certificateValue: certValue,
        perks,
        valueTotal,
        // Never advertise a saving that is not one.
        saving: Math.max(0, valueTotal - price)
    };
}

/** Every paid track, cheapest first — for a side-by-side comparison. */
function getAllBenefits() {
    return ['1month', '15days', '1week'].map(getBenefitsFor).filter(Boolean);
}

module.exports = {

    PAID_TENURES,
    PAYMENT_CUTOFF_DATE,
    purposeFor,
    allPurposesFor,
    getFeeFor,
    isExempt,
    TENURE_BENEFITS,
    CERTIFICATE_VALUES,
    CERTIFICATE_LABELS,
    COIN_RUPEE_VALUE,
    getBenefitsFor,
    getAllBenefits
};
