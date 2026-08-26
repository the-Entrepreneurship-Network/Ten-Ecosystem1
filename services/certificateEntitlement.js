'use strict';

/**
 * Is this student's fee for a course certificate already settled?
 *
 * There are three ways it can be, and until now each screen knew about a
 * different subset:
 *
 *   bought outright     a successful Payment for the certificate's purpose
 *   waived by a bundle  the zero-rupee Payment services/tenureBenefits.js
 *                       writes when a paid track is approved
 *   bought with coins   a completed CoinRedemption in the marketplace
 *
 * routes/v2/certificates.js checked ONLY the redemption, so the waiver the
 * paid tracks hand out was written and never read: a student on the Sprint
 * track, sold a "Fellowship fee included", still reached a Razorpay order for
 * ₹2,500. The payment screen promised something the certificate screen did not
 * honour.
 *
 * One definition, asked by both the status route and the claim route, so the
 * screen and the gate can never disagree about who has already paid.
 *
 * This says nothing about whether the certificate may be ISSUED. Eligibility —
 * completion percentage, cohort rank — is decided by getCertStatus and is
 * unchanged: a settled fee means the student is not asked for money again, not
 * that they have earned the certificate.
 */

/** my-certificates types → the Payment `purpose` and CoinRedemption `itemKey`. */
const CERT_KEYS = {
    expert:      { purpose: 'cert_expert',      itemKey: 'cert_expert' },
    nano_degree: { purpose: 'cert_nano_degree', itemKey: 'cert_nano' },
    fellowship:  { purpose: 'cert_fellowship',  itemKey: 'cert_fellowship' }
};

/**
 * @param {object} student a Student document or lean object
 * @param {string} type "expert" | "nano_degree" | "fellowship"
 * @returns {Promise<{covered: boolean, via: string|null}>}
 *          via is "purchase" | "bundle" | "coins", or null when it is not covered
 */
async function feeSettled(student, type) {
    const keys = CERT_KEYS[type];
    if (!student || !student._id || !keys) return { covered: false, via: null };

    const Payment = require('../models/Payment');
    const CoinRedemption = require('../models/new/CoinRedemption');

    const [payment, redemption] = await Promise.all([
        Payment.findOne({
            studentId: student._id,
            purpose: keys.purpose,
            status: { $in: ['success', 'pending_verification'] }
        }).select('metadata amount').lean().catch(() => null),
        CoinRedemption.findOne({
            employeeId: student.employeeId,
            itemType: 'certificate',
            itemKey: keys.itemKey,
            status: 'completed'
        }).select('_id').lean().catch(() => null)
    ]);

    if (payment) {
        const fromBundle = !!(payment.metadata && payment.metadata.grantedBy === 'tenure_bundle');
        return { covered: true, via: fromBundle ? 'bundle' : 'purchase' };
    }
    if (redemption) return { covered: true, via: 'coins' };
    return { covered: false, via: null };
}

/** All three at once, for the screen that draws all three cards. */
async function feeSettledAll(student) {
    const types = Object.keys(CERT_KEYS);
    const results = await Promise.all(types.map((t) => feeSettled(student, t)));
    return types.reduce((acc, t, i) => { acc[t] = results[i]; return acc; }, {});
}

module.exports = { feeSettled, feeSettledAll, CERT_KEYS };
