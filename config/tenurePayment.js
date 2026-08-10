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

module.exports = {
    PAID_TENURES,
    PAYMENT_CUTOFF_DATE,
    purposeFor,
    allPurposesFor,
    getFeeFor,
    isExempt
};
