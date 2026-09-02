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
 *   deferred     they chose "pay after completion", wrote to HR explaining why,
 *                and HR approved it: the portal opens and the fee is recorded
 *                as due. The CERTIFICATE is what waits, not the learning
 *   otherwise    no
 *
 * A deferral that HR has not decided yet grants nothing. The request is the
 * whole point of the queue — if the portal opened on the click, approving it
 * would be paperwork over a door already open.
 *
 * Nothing here reads the request. Access belongs to a student record, so a
 * cleared browser, a second device or a copied URL cannot change the answer.
 */

const studioPricing = require('../config/studioPricing');

/*
 * 'pending_verification' means the student typed a transaction number into the
 * box and nobody has checked it. It used to count as settled, so anyone could
 * open the paid portals by typing anything at all.
 *
 * It no longer grants anything — but access already given is not taken away.
 * Students who got in this way before the cutoff keep what they have, because
 * some of them really did pay and the portal is what they are using today.
 * `node scripts/list-unverified-studio-access.js` lists exactly who that is, so
 * the backlog can be checked by a person and the date moved forward afterwards.
 */
const SETTLED = ['success'];

const UNVERIFIED_UNTIL = new Date(
    process.env.STUDIO_UNVERIFIED_GRANDFATHER_UNTIL || '2026-09-02T00:00:00.000Z'
);

/** Did this row actually pay for what it claims? */
function isSettled(row) {
    if (SETTLED.includes(row.status)) return true;
    if (row.status !== 'pending_verification') return false;
    // Grandfathered: written before anybody was told this would stop working.
    return !!row.createdAt && new Date(row.createdAt) < UNVERIFIED_UNTIL;
}

/** Everything this student has ever bought or deferred in the Studio. */
async function studioPayments(studentId) {
    const Payment = require('../models/Payment');
    return Payment.find({
        studentId,
        purpose: { $in: studioPricing.allPurposes() },
        status: { $in: [...SETTLED, 'pending_verification', 'pending'] }
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
            row.metadata && row.metadata.payMode === studioPricing.PAY_MODES.AFTER &&
            !!row.metadata.deferApprovedAt;
        if (!isSettled(row) && !deferred) continue;

        studioPricing.unlocksFor(key).forEach((portal) => {
            // A settled purchase outranks a deferral: a student who deferred and
            // then paid should not still be told they owe money.
            if (portals[portal] && portals[portal].via === 'purchase') return;
            portals[portal] = { granted: true, via: deferred ? 'deferred' : 'purchase' };
        });

        if (deferred) {
            const product = studioPricing.getProduct(key);
            // What they owe is the deferred price — the ₹100 is the cost of
            // waiting, and the certificate screen must collect the real figure.
            feeDue = { product: key, name: product.name,
                amount: row.amount || studioPricing.deferredPriceFor(key) || product.price,
                since: row.createdAt };
        }
    }

    // Settled anywhere means nothing is owed — the deferral was honoured.
    if (feeDue && rows.some(isSettled)) feeDue = null;

    return { portals, feeDue, premium: premium.premium };
}

/**
 * The same answer, for a person who may hold TWO ids.
 *
 * An intern who upgrades buys through the Studio while signed into the intern
 * portal, so their Payment row carries their Student id; when they sign into
 * the Academic Portal, the session carries their EcosystemUser id. Same person,
 * two ids — matched here by email, or the thing they paid for opens nothing. A
 * paid internship track rides in the same way, because the Student row is what
 * carries the tenure.
 *
 * @param {object} subject anything with _id and email
 * @param {string} [portal] the portal that decides whether the twin is worth
 *                 checking; omit to check for any grant at all
 */
async function getStudioAccessForEither(subject, portal) {
    const direct = await getStudioAccess(subject);
    const has = (a) => portal
        ? Boolean(a.portals[portal] && a.portals[portal].granted)
        : studioPricing.PORTALS.some((p) => a.portals[p] && a.portals[p].granted);
    if (has(direct)) return direct;

    const email = String((subject && subject.email) || '').toLowerCase();
    if (!email) return direct;
    try {
        const Student = require('../models/Student');
        const twin = await Student.findOne({ email }).lean();
        if (twin && String(twin._id) !== String(subject._id)) {
            const viaStudent = await getStudioAccess(twin);
            if (has(viaStudent)) return viaStudent;
        }
    } catch (err) {
        console.error('[studio] twin-account lookup failed:', err.message);
    }
    return direct;
}

/** One portal, for the middleware, which only ever asks about one. */
async function canOpen(student, portal) {
    const { portals } = await getStudioAccessForEither(student, portal);
    return Boolean(portals[portal] && portals[portal].granted);
}

module.exports = {
    isSettled,
    UNVERIFIED_UNTIL, getStudioAccess, getStudioAccessForEither, canOpen };
