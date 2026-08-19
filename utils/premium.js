'use strict';

/**
 * Who counts as a premium student — the one definition.
 *
 * Premium means "on a paid track, and the fee is settled". It is deliberately
 * derived rather than stored as its own flag: a flag would be a third thing to
 * keep in step with the payment and the tenure, and the two of those already
 * disagree often enough (see config/tenurePayment.js on the two incompatible
 * payment implementations that used to exist).
 *
 * Three signals, any of which settles it, in the order the rest of the codebase
 * already trusts them:
 *
 *   tenureBenefits.grantedAt   an admin approved and the bundle was handed over
 *   shortCoursePaid            the older flag both approval routes still set
 *   isExistingStudent/cutoff   exempt students, who paid nothing but are not
 *                              to be treated as unpaid — they predate the fee
 *
 * A student on 45 Days, 3 Months or 6 Months is never premium: those tracks are
 * free, so there is no payment to have made, and dangling a locked section in
 * front of someone who cannot buy their way out of it is a dead end.
 */

const tenurePaymentConfig = require('../config/tenurePayment');
const { normalizeTenure } = require('./tenure');

/**
 * @param {object|null} student a Student document or lean object
 * @returns {{premium: boolean, onPaidTrack: boolean, plan: string,
 *            durationType: string|null, grantedAt: Date|null, reason: string}}
 */
function getPremiumStatus(student) {
    const out = {
        premium: false,
        onPaidTrack: false,
        plan: '',
        durationType: null,
        grantedAt: null,
        reason: 'no student'
    };
    if (!student) return out;

    const durationType = normalizeTenure(student.tenure);
    out.durationType = durationType;

    const fee = tenurePaymentConfig.getFeeFor(student);
    out.onPaidTrack = !!fee.required;

    // A free track has nothing to unlock and nothing to sell.
    if (!fee.required) {
        out.reason = 'free track';
        return out;
    }

    const benefits = student.tenureBenefits || {};
    if (benefits.grantedAt) {
        out.premium = true;
        out.plan = benefits.plan || '';
        out.grantedAt = benefits.grantedAt;
        out.reason = 'bundle granted';
        return out;
    }

    if (student.shortCoursePaid) {
        out.premium = true;
        out.reason = 'fee paid';
    } else if (tenurePaymentConfig.isExempt(student)) {
        // Registered before the fee existed. They never paid and never will —
        // locking them out would be punishing them for being early.
        out.premium = true;
        out.reason = 'exempt';
    } else {
        out.reason = 'fee unpaid';
        return out;
    }

    // Fall back to the track's own plan name when the bundle record predates
    // this feature, so the badge still says Starter/Accelerate/Sprint.
    const bundle = tenurePaymentConfig.getBenefitsFor(durationType);
    out.plan = out.plan || (bundle && bundle.name) || '';
    return out;
}

/** Convenience for call sites that only need the yes/no. */
function isPremium(student) {
    return getPremiumStatus(student).premium;
}

/**
 * Express guard for premium-only APIs.
 *
 * Answers 402 rather than 403 on purpose: this is not "you may never have
 * this", it is "there is a price on it", and the front end shows the upsell
 * instead of an error when it sees that status.
 */
function requirePremium(req, res, next) {
    (async () => {
        try {
            const employeeId = (req.session && req.session.student && req.session.student.employeeId)
                || (req.student && req.student.employeeId) || '';
            if (!employeeId) {
                return res.status(401).json({ success: false, message: 'Please sign in.' });
            }
            const Student = require('../models/Student');
            const student = await Student.findOne({ employeeId }).lean();
            const status = getPremiumStatus(student);
            if (!status.premium) {
                return res.status(402).json({
                    success: false,
                    premiumRequired: true,
                    onPaidTrack: status.onPaidTrack,
                    message: status.onPaidTrack
                        ? 'Complete your programme fee to unlock this.'
                        : 'This is part of the paid tracks.'
                });
            }
            req.premium = status;
            req.premiumStudent = student;
            next();
        } catch (err) {
            // Fails closed. An unknown status is not a licence to enter.
            console.error('[premium] guard failed:', err.message);
            res.status(503).json({ success: false, message: 'Could not verify your access. Please try again.' });
        }
    })();
}

module.exports = { getPremiumStatus, isPremium, requirePremium };
