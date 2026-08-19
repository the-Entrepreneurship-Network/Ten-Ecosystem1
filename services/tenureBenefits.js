'use strict';

/**
 * Hand a paid student what their track promised, the moment an admin approves.
 *
 * The payment screen sells a bundle (config/tenurePayment.js). Selling it and
 * then delivering nothing is worse than never having sold it, so this runs on
 * approval and grants the two things the bundle claims automatically:
 *
 *   coins        credited to the student's marketplace balance
 *   certificate  the FEE waived — a zero-rupee Payment row for the tier's
 *                certificate purpose
 *
 * The waiver is a Payment row on purpose. Certificate access is already decided
 * everywhere by "is there a successful Payment for this purpose?"
 * (routes/v2/payment.js, routes/adminPortal.js), so writing one grants the
 * entitlement through the existing check instead of adding a second, parallel
 * notion of who may have a certificate. The amount is 0 and the provider is
 * "manual", so revenue reporting still sees no money where none arrived.
 *
 * A waived fee is not an issued certificate: eligibility — finishing the
 * programme, attendance, the task journey — is unchanged and still enforced
 * elsewhere. The screen says "fee included" for exactly that reason.
 *
 * Both admin approval paths call this (routes/adminPortal.js), so a student
 * gets the same bundle whichever button an admin happens to press.
 */

const tenurePaymentConfig = require('../config/tenurePayment');
const { normalizeTenure } = require('../utils/tenure');

/** Plan name → the badge in server.js's BADGE_CATALOG. */
const PLAN_BADGES = { Starter: 'premium_starter', Accelerate: 'premium_accelerate', Sprint: 'premium_sprint' };
const PLAN_BADGE_ICONS = { Starter: '🥉', Accelerate: '🥈', Sprint: '🥇' };

/**
 * Credit coins, creating the balance if the student has never had one.
 *
 * Uses one atomic update rather than read-modify-write: two approvals landing
 * together would otherwise both read the same balance and one credit would be
 * lost.
 */
async function creditCoins(studentId, coins, reason) {
    if (!coins || coins <= 0) return 0;
    const StudentCoin = require('../models/new/StudentCoin');
    const entry = { action: reason, coins, timestamp: new Date() };

    const doc = await StudentCoin.findOneAndUpdate(
        { studentId },
        {
            $inc: { totalCoins: coins },
            $push: { coinsHistory: entry },
            $set: { lastUpdated: new Date() }
        },
        { new: true, upsert: true, setDefaultsOnInsert: true }
    );
    return (doc && doc.totalCoins) || coins;
}

/**
 * Waive the certificate fee by recording a zero-rupee successful payment.
 *
 * Returns false when the student already has one — bought or waived — so a
 * re-approval cannot stack duplicates, and so a student who already paid for
 * that certificate is not quietly given a second entitlement.
 */
async function waiveCertificateFee(student, purpose, sourceOrderId) {
    if (!purpose) return false;
    const Payment = require('../models/Payment');

    const existing = await Payment.findOne({
        studentId: student._id,
        purpose,
        status: { $in: ['success', 'pending_verification'] }
    }).select('_id').lean();
    if (existing) return false;

    await Payment.create({
        orderId: `BUNDLE-${purpose}-${student._id}-${Date.now()}`,
        studentId: student._id,
        employeeId: student.employeeId || null,
        amount: 0,
        amountRupees: 0,
        provider: 'manual',
        mode: 'manual',
        purpose,
        status: 'success',
        verifiedBy: 'system:tenure-bundle',
        verifiedAt: new Date(),
        description: 'Certificate fee included with the paid internship track',
        metadata: { grantedBy: 'tenure_bundle', sourceOrderId: sourceOrderId || null }
    });
    return true;
}

/**
 * Grant the bundle for this student's track.
 *
 * Idempotent: a second call for a student who already has their bundle returns
 * `{ granted: false }` and changes nothing, so re-approving a payment — or the
 * two approval routes both firing — cannot double-credit coins.
 *
 * Never throws into the caller. An approval that succeeded must not be reported
 * as failed because a perk could not be handed over; the failure is logged and
 * the payment stays approved.
 *
 * @param {object} student  a Student document (or lean object with _id)
 * @param {object} [options]
 * @param {string} [options.sourceOrderId] the tenure payment this came from
 * @returns {Promise<{granted: boolean, reason?: string, bundle?: object}>}
 */
async function grantTenureBenefits(student, options = {}) {
    try {
        if (!student || !student._id) return { granted: false, reason: 'no student' };

        const durationType = normalizeTenure(student.tenure);
        const bundle = tenurePaymentConfig.getBenefitsFor(durationType);
        // A free track has no bundle, and must never be given one.
        if (!bundle) return { granted: false, reason: 'not a paid track' };

        const Student = require('../models/Student');

        // Idempotency, checked against the database rather than the object we
        // were handed, which may be stale.
        const fresh = await Student.findById(student._id).select('tenureBenefits employeeId tenure').lean();
        if (fresh && fresh.tenureBenefits && fresh.tenureBenefits.grantedAt) {
            return { granted: false, reason: 'already granted', bundle };
        }

        const coinBalance = await creditCoins(
            student._id,
            bundle.coins,
            `${bundle.name} track bonus`
        );
        const certificateWaived = await waiveCertificateFee(
            { _id: student._id, employeeId: (fresh && fresh.employeeId) || student.employeeId },
            bundle.certificate,
            options.sourceOrderId
        );

        await Student.updateOne(
            { _id: student._id },
            {
                $set: {
                    tenureBenefits: {
                        plan: bundle.name,
                        durationType: bundle.durationType,
                        grantedAt: new Date(),
                        coinsGranted: bundle.coins,
                        certificate: bundle.certificate,
                        certificateLabel: bundle.certificateLabel,
                        certificateWaived,
                        valueTotal: bundle.valueTotal,
                        perks: bundle.perks.map((p) => p.label)
                    }
                }
            }
        );

        // The badge that marks them out in the portal. BadgeAward is written
        // directly rather than through server.js's awardBadgeIfNew, which lives
        // in the app module and cannot be required from here without a cycle.
        try {
            const BadgeAward = require('../models/BadgeAward');
            const badgeId = PLAN_BADGES[bundle.name];
            if (badgeId && (fresh && fresh.employeeId)) {
                await BadgeAward.updateOne(
                    { employeeId: fresh.employeeId, badgeId },
                    {
                        $setOnInsert: {
                            studentId: student._id,
                            employeeId: fresh.employeeId,
                            badgeId,
                            badgeName: `${bundle.name} Member`,
                            badgeIcon: PLAN_BADGE_ICONS[bundle.name] || '⭐',
                            awardedAt: new Date()
                        }
                    },
                    { upsert: true }
                );
            }
        } catch (badgeErr) {
            // A duplicate is the unique index doing its job, not a failure.
            if (!badgeErr || badgeErr.code !== 11000) {
                console.error('[tenure-benefits] badge award failed:', badgeErr.message);
            }
        }

        // A waived certificate fee is an entitlement granted without money
        // changing hands, so it leaves a record like every other one.
        try {
            const AuditLog = require('../models/AuditLog');
            await AuditLog.create({
                userId: student._id,
                actionType: 'tenure_bundle_granted',
                performedBy: 'system',
                description: `${bundle.name} track bundle granted: ${bundle.coins} coins`
                    + `${certificateWaived ? `, ${bundle.certificateLabel} fee waived` : ''}`,
                newState: {
                    plan: bundle.name,
                    coins: bundle.coins,
                    certificate: bundle.certificate,
                    certificateWaived
                }
            });
        } catch (auditErr) {
            console.error('[tenure-benefits] audit log failed:', auditErr.message);
        }

        // Best effort: the student has their bundle whether or not the bell rings.
        try {
            const Notification = require('../models/Notification');
            if (Notification && typeof Notification.notifyStudent === 'function') {
                await Notification.notifyStudent(student, {
                    title: `Your ${bundle.name} track is unlocked 🎉`,
                    message: `${bundle.coins.toLocaleString('en-IN')} coins are in your marketplace balance and your `
                        + `${bundle.certificateLabel} fee is covered. Open the dashboard to see everything included.`,
                    type: 'success'
                });
            }
        } catch (notifyErr) {
            console.error('[tenure-benefits] notification failed:', notifyErr.message);
        }

        return { granted: true, bundle, coinBalance, certificateWaived };
    } catch (err) {
        console.error('[tenure-benefits] grant failed:', err.message);
        return { granted: false, reason: err.message };
    }
}

module.exports = { grantTenureBenefits, creditCoins, waiveCertificateFee };
