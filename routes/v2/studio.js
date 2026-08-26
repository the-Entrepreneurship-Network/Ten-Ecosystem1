'use strict';

/**
 * Buying the Career Studio.
 *
 * Deliberately the same shape as the internship fee (`/api/tenure-payment/*`):
 * the student scans the UPI QR, pays, types the transaction id, and an admin
 * approves it. That flow already works, students already know it, and the
 * approval queue in routes/adminPortal.js already understands a Payment row —
 * so this adds products, not a second payment system.
 *
 * The one thing that is new is "pay after completion": the portals open now
 * and the fee is recorded as due. The certificate is what waits for the money,
 * not the learning.
 *
 * Prices are read from config/studioPricing.js and never from the request. A
 * client that could name its own amount could buy the ₹500 combo for ₹1.
 */

const express = require('express');
const router = express.Router();

const studioPricing = require('../../config/studioPricing');
const studioAccess = require('../../services/studioAccess');

/** The signed-in student, or null. Same resolution the rest of the app uses. */
async function currentStudent(req) {
    const Student = require('../../models/Student');
    const s = (req.session && req.session.student) || null;
    const who = req.headers['x-employee-id'] || (s && (s.employeeId || s._id || s.id)) || '';
    if (!who) return null;

    const byEmployee = await Student.findOne({ employeeId: String(who) }).lean();
    if (byEmployee) return byEmployee;

    const mongoose = require('mongoose');
    if (mongoose.Types.ObjectId.isValid(who)) {
        const byId = await Student.findById(who).lean();
        if (byId) return byId;
    }
    return s && s.email ? Student.findOne({ email: String(s.email).toLowerCase() }).lean() : null;
}

function requireStudent(handler) {
    return async (req, res) => {
        try {
            const student = await currentStudent(req);
            if (!student) return res.status(401).json({ success: false, message: 'Please sign in.' });
            return await handler(req, res, student);
        } catch (err) {
            console.error('[studio] ' + req.path + ':', err.message);
            return res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
        }
    };
}

/**
 * GET /api/v2/studio/status
 * What this student can already open, what it costs, and what they owe.
 * The pricing screen renders entirely from this.
 */
router.get('/status', requireStudent(async (req, res, student) => {
    const access = await studioAccess.getStudioAccess(student);
    const Payment = require('../../models/Payment');
    const awaiting = await Payment.findOne({
        studentId: student._id,
        purpose: { $in: studioPricing.allPurposes() },
        status: 'pending_verification'
    }).select('purpose amount txnUtr createdAt').lean();

    return res.json({
        success: true,
        pricing: studioPricing.getPricingTable(),
        portals: access.portals,
        feeDue: access.feeDue,
        // A paid internship track includes the whole Studio, so it must never
        // be shown a price for something it already owns.
        includedWithTrack: access.premium,
        awaitingApproval: awaiting
            ? { product: studioPricing.productKeyFromPurpose(awaiting.purpose),
                amount: awaiting.amount, utr: awaiting.txnUtr, since: awaiting.createdAt }
            : null,
        upiId: process.env.UPI_ID || 'paytmqr5k0ods@ptys'
    });
}));

/**
 * POST /api/v2/studio/choose  { product, payMode }
 *
 * "now"   — records the order and hands back the QR details to pay against.
 * "after" — opens the portals immediately and books the fee as due.
 */
router.post('/choose', requireStudent(async (req, res, student) => {
    const productKey = String((req.body && req.body.product) || '');
    const payMode = String((req.body && req.body.payMode) || studioPricing.PAY_MODES.NOW);
    const product = studioPricing.getProduct(productKey);

    if (!product) return res.status(400).json({ success: false, message: 'Unknown product.' });
    if (payMode !== studioPricing.PAY_MODES.NOW && payMode !== studioPricing.PAY_MODES.AFTER) {
        return res.status(400).json({ success: false, message: 'Unknown payment option.' });
    }

    const access = await studioAccess.getStudioAccess(student);
    if (access.premium) {
        return res.json({ success: true, alreadyOwned: true, via: 'tenure',
            message: 'Your internship track already includes all of this.' });
    }
    const covered = product.unlocks.every((p) => access.portals[p] && access.portals[p].granted
        && access.portals[p].via === 'purchase');
    if (covered) {
        return res.json({ success: true, alreadyOwned: true, via: 'purchase',
            message: 'You already have this.' });
    }

    const Payment = require('../../models/Payment');
    const purpose = studioPricing.purposeFor(productKey);

    /* One open order per product. Pressing the button twice must not leave two
       rows for an admin to approve and a student to wonder about. */
    const open = await Payment.findOne({
        studentId: student._id, purpose, status: { $in: ['pending', 'pending_verification'] }
    }).lean();
    if (open) {
        return res.json({ success: true, orderId: open.orderId, reused: true,
            product: productKey, amount: product.price,
            payMode: (open.metadata && open.metadata.payMode) || studioPricing.PAY_MODES.NOW });
    }

    const orderId = `STUDIO-${productKey}-${student._id}-${Date.now()}`;
    await Payment.create({
        orderId,
        studentId: student._id,
        employeeId: student.employeeId || null,
        amount: product.price,
        amountRupees: product.price,
        currency: 'INR',
        provider: 'upi',
        mode: 'upi',
        purpose,
        // "pending" is exactly right for a deferral: nothing has been paid, and
        // the row is the record of the promise. metadata.payMode is what tells
        // services/studioAccess.js to open the portals anyway.
        status: 'pending',
        description: product.name + (payMode === studioPricing.PAY_MODES.AFTER
            ? ' — pay after completion' : ''),
        customerName: student.name || null,
        customerEmail: student.email || null,
        metadata: { payMode, products: product.unlocks, source: 'studio' }
    });

    return res.status(201).json({
        success: true,
        orderId,
        product: productKey,
        name: product.name,
        amount: product.price,
        payMode,
        // Nothing to pay yet, so nothing to scan.
        opensNow: payMode === studioPricing.PAY_MODES.AFTER
    });
}));

/**
 * POST /api/v2/studio/submit-utr  { orderId, utr }
 * The student has paid and is telling us the transaction id. An admin verifies
 * it in the existing approval queue.
 */
router.post('/submit-utr', requireStudent(async (req, res, student) => {
    const orderId = String((req.body && req.body.orderId) || '').trim();
    const utr = String((req.body && req.body.utr) || '').trim();

    if (!/^[A-Za-z0-9]{6,25}$/.test(utr)) {
        return res.status(400).json({ success: false,
            message: 'Please enter a valid Transaction ID (6 to 25 characters, letters and numbers only).' });
    }

    const Payment = require('../../models/Payment');
    const order = await Payment.findOne({ orderId });
    if (!order) return res.status(404).json({ success: false, message: 'Order not found.' });
    // Someone else's order is not yours to settle.
    if (String(order.studentId) !== String(student._id)) {
        return res.status(403).json({ success: false, message: 'That order is not yours.' });
    }
    if (order.status === 'success') {
        return res.json({ success: true, alreadyApproved: true, message: 'This is already paid.' });
    }

    order.status = 'pending_verification';
    order.txnUtr = utr;
    order.updatedAt = new Date();
    await order.save();

    return res.json({ success: true,
        message: 'Thank you. Your payment is with our team — access opens as soon as it is approved.' });
}));

/**
 * GET /api/v2/studio/pricing
 *
 * The price list, public. The overview page shows figures to visitors who have
 * no account yet, and the alternative is that page carrying its own copy of
 * the numbers — which is how two screens end up quoting two prices. Prices are
 * not a secret; the /status route stays authenticated because it says what a
 * PERSON owns, and this says only what the SHOP charges.
 */
router.get('/pricing', (req, res) => {
    res.json({ success: true, pricing: studioPricing.getPricingTable() });
});

/**
 * POST /api/v2/studio/lead  { email }
 *
 * The box on the Career Studio page. Public and unauthenticated by necessity —
 * the whole point is that the person filling it in does not have an account
 * yet.
 *
 * Two things follow from that. The reply never says whether the address was
 * new, so it cannot be used to ask "is this person signed up?" about anybody.
 * And it is rate limited by the /api limiter already in front of every route
 * here, on top of the one-mail-per-address rule in the service, so it cannot
 * be turned into a way to send mail at somebody repeatedly.
 */
router.post('/lead', async (req, res) => {
    try {
        const result = await require('../../services/studioLead').captureLead(
            req.body && req.body.email,
            { source: 'student-portal', referrer: req.get('referer') || '' }
        );
        if (!result.ok) {
            return res.status(400).json({ success: false, message: 'That does not look like an email address.' });
        }
        return res.json({
            success: true,
            message: 'Check your inbox — we have sent you everything the Studio opens up.'
        });
    } catch (err) {
        console.error('[studio] lead:', err.message);
        return res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
    }
});

module.exports = router;
