'use strict';

/**
 * Server-side enforcement of the internship programme fee.
 *
 * The gate previously existed ONLY as an overlay inside
 * public/student-dashboard.html. An unpaid student could navigate straight to
 * /v2-tasks.html, /quiz-portal.html or /my-certificates.html and use the portal
 * normally, and the overlay itself failed open — any network error let them
 * through (`.catch(...)` fell into showWelcomeModalIfNeeded).
 *
 * The rule, per the task document (issue 6.2):
 *   fee applies to 1 Week / 15 Days / 1 Month only.
 *   45 Days / 3 Months / 6 Months are FREE — those students must never be
 *   blocked and must never see a payment screen anywhere in the product.
 *
 * Fails CLOSED: an unexpected error returns 503 rather than granting access.
 */

const Student = require('../models/Student');
const Payment = require('../models/Payment');
const tenurePaymentConfig = require('../config/tenurePayment');

function sessionEmployeeId(req) {
    return (req.session && req.session.student && req.session.student.employeeId) || '';
}

/**
 * Has this student settled the programme fee (or does it not apply)?
 * @returns {Promise<{settled: boolean, fee: object, student: object|null}>}
 */
async function checkTenurePayment(employeeId) {
    const student = await Student.findOne({ employeeId }).lean();
    if (!student) return { settled: true, fee: { required: false }, student: null };

    const fee = tenurePaymentConfig.getFeeFor(student);

    if (!fee.required) return { settled: true, fee, student };                   // free tenure
    if (tenurePaymentConfig.isExempt(student)) return { settled: true, fee, student };
    if (student.shortCoursePaid) return { settled: true, fee, student };

    const payment = await Payment.findOne({
        studentId: student._id,
        purpose: { $in: tenurePaymentConfig.allPurposesFor(fee.durationType) },
        status: { $in: ['success', 'pending_verification'] }
    });

    return { settled: !!payment, fee, student };
}

async function requireTenurePaid(req, res, next) {
    try {
        const employeeId = sessionEmployeeId(req)
            || (req.student && req.student.employeeId)
            || '';
        // No session — the auth guard in front of this handles it.
        if (!employeeId) return next();

        const { settled, fee } = await checkTenurePayment(employeeId);
        if (settled) return next();

        return res.status(402).json({
            success: false,
            paymentRequired: true,
            message: `Please complete your ${fee.label} Internship Program fee to continue.`,
            amount: fee.amount,
            label: fee.label
        });
    } catch (err) {
        console.error('[tenure-gate] Payment check failed:', err.message);
        return res.status(503).json({
            success: false,
            message: 'Could not verify your payment status. Please try again.'
        });
    }
}

module.exports = { requireTenurePaid, checkTenurePayment };
