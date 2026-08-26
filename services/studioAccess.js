'use strict';

/**
 * Can this student open the Course, the Resume Portal or the Job Portal?
 *
 * One answer, asked by everything: the middleware in front of the static
 * files, the pricing screen deciding what to offer, and the certificate route
 * deciding whether a fee is still owed. Three copies of this rule would drift,
 * and a paywall that disagrees with itself either sells something twice or
 * gives it away.
 *
 * Four ways in, in the order they are checked:
 *
 *   bought       a settled Payment for a product whose bundle covers it
 *   included     the student is on a paid internship track — those already
 *                cost ₹1,000–₹2,000 and include the whole ₹500 Studio
 *   deferred     they chose "pay after completion": the portal opens now and
 *                the fee is recorded as due. The CERTIFICATE is what waits,
 *                not the learning
 *   otherwise    no
 *
 * Nothing here reads the request. Access belongs to a student record, so a
 * cleared browser, a second device or a copied URL cannot change the answer.
 */

const studioPricing = require('../config/studioPricing');

const SETTLED = ['success', 'pending_verification'];

/** Everything this student has ever bought or deferred in the Studio. */
async function studioPayments(studentId) {
    const Payment = require('../models/Payment');
    return Payment.find({
        studentId,
        purpose: { $in: studioPricing.allPurposes() },
        status: { $in: [...SETTLED, 'pending'] }
    }).select('purpose status metadata amount createdAt').lean();
}

/**
 * @param {object|null} student a Student document or lean object
 * @returns {Promise<{portals: object, feeDue: object|null, premium: boolean}>}
 *   portals — { course: {granted, via}, resume: {...}, job: {...} }
 *   feeDue  — the deferred payment still owed, or null
 */
async function getStudioAccess(student) {
    const portals = {};
    studioPricing.PORTALS.forEach((p) => { portals[p] = { granted: false, via: null }; });
    if (!student || !student._id) return { portals, feeDue: null, premium: false };

    /* A paid internship track includes the whole Studio. Checked first because
       it needs no payment row of its own and cannot be revoked by one. */
    const premium = require('../utils/premium').getPremiumStatus(student);
    if (premium.premium) {
        studioPricing.PORTALS.forEach((p) => { portals[p] = { granted: true, via: 'tenure' }; });
    }

    let rows = [];
    try {
        rows = await studioPayments(student._id);
    } catch (err) {
        // Fail CLOSED for buying, OPEN for what the track already includes: a
        // database blip must not lock a paying student out of what they own,
        // and must not hand the Studio to somebody who never bought it.
        console.error('[studio] payment lookup failed:', err.message);
        return { portals, feeDue: null, premium: premium.premium };
    }

    let feeDue = null;
    for (const row of rows) {
        const key = studioPricing.productKeyFromPurpose(row.purpose);
        if (!key) continue;
        const deferred = row.status === 'pending' &&
            row.metadata && row.metadata.payMode === studioPricing.PAY_MODES.AFTER;
        if (!SETTLED.includes(row.status) && !deferred) continue;

        studioPricing.unlocksFor(key).forEach((portal) => {
            // A settled purchase outranks a deferral: a student who deferred and
            // then paid should not still be told they owe money.
            if (portals[portal] && portals[portal].via === 'purchase') return;
            portals[portal] = { granted: true, via: deferred ? 'deferred' : 'purchase' };
        });

        if (deferred) {
            const product = studioPricing.getProduct(key);
            feeDue = { product: key, name: product.name, amount: product.price, since: row.createdAt };
        }
    }

    // Settled anywhere means nothing is owed — the deferral was honoured.
    if (feeDue && rows.some((r) => SETTLED.includes(r.status))) feeDue = null;

    return { portals, feeDue, premium: premium.premium };
}

/** One portal, for the middleware, which only ever asks about one. */
async function canOpen(student, portal) {
    const { portals } = await getStudioAccess(student);
    return Boolean(portals[portal] && portals[portal].granted);
}

module.exports = { getStudioAccess, canOpen };
