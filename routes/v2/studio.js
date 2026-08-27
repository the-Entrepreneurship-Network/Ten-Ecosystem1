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

    /*
     * A learner — an Academic Portal account with no Student row — can buy
     * here too: the registration page collects their payment through these
     * same routes. Their EcosystemUser id plays the studentId role on the
     * Payment row, which is exactly the id /learn checks access with.
     */
    const learner = req.session && req.session.learner;
    if (learner && !(req.session && req.session.student)) {
        return { _id: learner.id, employeeId: null, tenure: null,
                 name: learner.name, email: learner.email, isLearner: true };
    }

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

    /* A pay-after request that HR has not decided yet. It grants nothing, so
       without this the student's portal would show no trace of the thing they
       just asked for. */
    const pendingDefer = await Payment.findOne({
        studentId: student._id,
        purpose: { $in: studioPricing.allPurposes() },
        status: 'pending',
        'metadata.payMode': studioPricing.PAY_MODES.AFTER,
        'metadata.deferApprovedAt': { $exists: false }
    }).select('purpose amount createdAt metadata').lean();

    return res.json({
        success: true,
        // Who is signed in, so the screen can say so — "show their details,
        // then the upgrade" is the flow for an existing account.
        student: { name: student.name || '', employeeId: student.employeeId || '',
                   domain: student.domain || '', tenure: student.tenure || '',
                   email: student.email || '', isLearner: !!student.isLearner },
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
        deferralPending: pendingDefer
            ? { product: studioPricing.productKeyFromPurpose(pendingDefer.purpose),
                amount: pendingDefer.amount, since: pendingDefer.createdAt }
            : null,
        upiId: process.env.UPI_ID || 'paytmqr5k0ods@ptys'
    });
}));

/**
 * POST /api/v2/studio/choose  { product, payMode, reason }
 *
 * "now"   — records the order and hands back the QR details to pay against.
 * "after" — books the fee as due at the deferred price and sends the student's
 *           reason to HR. Nothing opens until HR approves it; there is no QR on
 *           this path at all, which is the point of choosing it.
 */
router.post('/choose', requireStudent(async (req, res, student) => {
    const productKey = String((req.body && req.body.product) || '');
    const payMode = String((req.body && req.body.payMode) || studioPricing.PAY_MODES.NOW);
    const reason = String((req.body && req.body.reason) || '').trim().slice(0, 1200);
    const product = studioPricing.getProduct(productKey);

    if (!product) return res.status(400).json({ success: false, message: 'Unknown product.' });
    if (payMode !== studioPricing.PAY_MODES.NOW && payMode !== studioPricing.PAY_MODES.AFTER) {
        return res.status(400).json({ success: false, message: 'Unknown payment option.' });
    }
    // Pay-after-completion exists only where a completion exists to pay at —
    // the course. Job and Resume are consumed as they are used, so they are
    // pay-first, and the combo contains them, so it is too.
    if (payMode === studioPricing.PAY_MODES.AFTER && !product.deferrable) {
        return res.status(400).json({ success: false,
            message: `${product.name} is pay-first. Only the course offers pay after completion.` });
    }
    // The request IS the reason. An empty box would leave HR approving names.
    if (payMode === studioPricing.PAY_MODES.AFTER && reason.length < 15) {
        return res.status(400).json({ success: false,
            message: 'Please tell us in a line or two why you cannot pay right now — HR reads this.' });
    }

    const deferring = payMode === studioPricing.PAY_MODES.AFTER;
    const amount = deferring ? studioPricing.deferredPriceFor(productKey) : product.price;

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
    /*
     * "Actually, I will pay now."
     *
     * An open pay-after request that HR has NOT decided is a promise, not a
     * debt: changing your mind before it is granted must cost the up-front
     * price. Reusing that row as-is would have quoted the ₹100 surcharge to
     * somebody who had just chosen not to wait for it.
     */
    if (open && !deferring
        && open.metadata && open.metadata.payMode === studioPricing.PAY_MODES.AFTER
        && !open.metadata.deferApprovedAt) {
        await Payment.updateOne({ _id: open._id }, {
            $set: {
                amount: product.price, amountRupees: product.price,
                description: product.name, updatedAt: new Date(),
                'metadata.payMode': studioPricing.PAY_MODES.NOW,
                'metadata.withdrewRequestAt': new Date()
            }
        });
        return res.json({ success: true, orderId: open.orderId, reused: true,
            product: productKey, name: product.name, amount: product.price,
            payMode: studioPricing.PAY_MODES.NOW });
    }

    if (open) {
        const openMode = (open.metadata && open.metadata.payMode) || studioPricing.PAY_MODES.NOW;
        return res.json({ success: true, orderId: open.orderId, reused: true,
            product: productKey, name: product.name, amount: open.amount || product.price,
            payMode: openMode,
            // A request already with HR is not a second request, and never a QR.
            requested: openMode === studioPricing.PAY_MODES.AFTER,
            awaitingHR: openMode === studioPricing.PAY_MODES.AFTER
                && !(open.metadata && open.metadata.deferApprovedAt) });
    }

    const orderId = `STUDIO-${productKey}-${student._id}-${Date.now()}`;
    await Payment.create({
        orderId,
        studentId: student._id,
        employeeId: student.employeeId || null,
        amount,
        amountRupees: amount,
        currency: 'INR',
        provider: 'upi',
        mode: 'upi',
        purpose,
        // "pending" is exactly right for a deferral: nothing has been paid, and
        // the row is the record of the promise. metadata.deferApprovedAt is what
        // later tells services/studioAccess.js to open the portals anyway.
        status: 'pending',
        description: product.name + (deferring ? ' — pay after completion' : ''),
        customerName: student.name || null,
        customerEmail: student.email || null,
        metadata: {
            payMode, products: product.unlocks, source: 'studio',
            ...(deferring ? { reason, deferRequestedAt: new Date() } : {})
        }
    });

    if (deferring) {
        await require('../../services/hrAlert').alertHR({
            title: 'Pay-after-completion request — decision needed',
            message: `${student.name || 'A student'} (${student.email || 'no email'}) asked to start `
                + `${product.name} now and pay ₹${amount} at the end. Reason: ${reason}`,
            link: '/hr-deferrals.html',
            data: { orderId },
            subject: `[TEN] Pay-after request — ${student.name || student.email || 'student'}`,
            bodyHtml: `<p><b>${escapeText(student.name || 'A student')}</b> `
                + `(${escapeText(student.email || 'no email')}) wants to start `
                + `<b>${escapeText(product.name)}</b> now and pay <b>₹${amount}</b> on completion.</p>`
                + `<p style="margin-top:10px;"><b>Why they cannot pay now:</b><br>${escapeText(reason)}</p>`
                + '<p style="margin-top:10px;">Nothing is open for them until this is approved.</p>',
            ctaLabel: 'Open the requests queue'
        });
    }

    return res.status(201).json({
        success: true,
        orderId,
        product: productKey,
        name: product.name,
        amount,
        payMode,
        // Nothing to pay, so nothing to scan — and nothing open either, until HR
        // has read the request.
        requested: deferring,
        awaitingHR: deferring
    });
}));

/** Text into HTML. Mail bodies carry a student's own words. */
function escapeText(v) {
    return String(v == null ? '' : v)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

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
 * It is rate limited by the /api limiter already in front of every route here,
 * on top of the one-mail-per-address rule in the service, so it cannot be
 * turned into a way to send mail at somebody repeatedly.
 *
 * ponytail: the reply used to be identical for a new and an existing address so
 * it could not be used to ask "is this person signed up?". It now says "already
 * sent" instead, because a second attempt that answers "check your inbox" when
 * no second mail is coming reads as a broken form. The list it leaks membership
 * of is a marketing lead list; if that ever stops being acceptable, put the
 * distinction behind a signed-in check rather than dropping it again.
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
            already: !result.fresh,
            message: result.fresh
                ? 'Check your inbox — we have sent you everything the Studio opens up.'
                : 'We have already sent it to that address — please check your inbox, and your spam folder.'
        });
    } catch (err) {
        console.error('[studio] lead:', err.message);
        return res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
    }
});

/* ── the HR desk for pay-after requests ──────────────────────────────────── */

/** HR or an admin. Same gate the proctoring queue uses. */
function requireHR(handler) {
    return async (req, res) => {
        try {
            if (!req.session || (!req.session.hr && !req.session.adminUser)) {
                return res.status(403).json({ success: false, message: 'HR sign-in required.' });
            }
            return await handler(req, res);
        } catch (err) {
            console.error('[studio] ' + req.path + ':', err.message);
            return res.status(500).json({ success: false, message: 'Something went wrong.' });
        }
    };
}

/**
 * GET /api/v2/studio/hr/deferrals
 * Everyone who asked to pay at the end, undecided first.
 */
router.get('/hr/deferrals', requireHR(async (req, res) => {
    const Payment = require('../../models/Payment');
    const rows = await Payment.find({
        purpose: { $in: studioPricing.allPurposes() },
        'metadata.payMode': studioPricing.PAY_MODES.AFTER
    }).sort({ createdAt: -1 }).limit(200)
      .select('orderId amount status description customerName customerEmail createdAt metadata').lean();

    res.json({
        success: true,
        requests: rows.map((r) => ({
            id: String(r._id),
            orderId: r.orderId,
            name: r.customerName || '',
            email: r.customerEmail || '',
            product: studioPricing.productKeyFromPurpose(r.purpose),
            productName: r.description || '',
            amount: r.amount,
            reason: (r.metadata && r.metadata.reason) || '',
            since: r.createdAt,
            status: r.status === 'failed' ? 'rejected'
                : (r.metadata && r.metadata.deferApprovedAt) ? 'approved'
                : r.status === 'pending' ? 'pending' : 'settled',
            decidedBy: (r.metadata && r.metadata.deferDecidedBy) || '',
            hrNote: (r.metadata && r.metadata.deferNote) || ''
        }))
    });
}));

/**
 * POST /api/v2/studio/hr/deferrals/:id/decide  { action, note }
 *
 * approve — the portal opens and the fee stays due until they finish.
 * reject  — the request is closed and they are told to pay to start.
 * Either way the student gets the mail; a decision nobody hears about is a
 * student refreshing a screen that will never change.
 */
router.post('/hr/deferrals/:id/decide', requireHR(async (req, res) => {
    const action = String((req.body && req.body.action) || '');
    const note = String((req.body && req.body.note) || '').slice(0, 2000);
    if (action !== 'approve' && action !== 'reject') {
        return res.status(400).json({ success: false, message: 'approve or reject.' });
    }

    const Payment = require('../../models/Payment');
    const row = await Payment.findById(req.params.id);
    if (!row || !studioPricing.productKeyFromPurpose(row.purpose)) {
        return res.status(404).json({ success: false, message: 'Request not found.' });
    }
    if (!row.metadata || row.metadata.payMode !== studioPricing.PAY_MODES.AFTER) {
        return res.status(400).json({ success: false, message: 'That is not a pay-after request.' });
    }
    if (row.metadata.deferApprovedAt || row.status === 'failed') {
        return res.status(409).json({ success: false, message: 'Already decided.' });
    }

    const decidedBy = (req.session.hr && (req.session.hr.name || req.session.hr.username))
        || (req.session.adminUser && req.session.adminUser.username) || 'HR';

    // Mongoose will not notice a mutated Mixed field; assigning a fresh object
    // and marking it is what actually persists a metadata change.
    row.metadata = {
        ...row.metadata,
        deferNote: note,
        deferDecidedBy: decidedBy,
        deferDecidedAt: new Date(),
        ...(action === 'approve' ? { deferApprovedAt: new Date() } : {})
    };
    row.markModified('metadata');
    if (action === 'reject') row.status = 'failed';
    row.updatedAt = new Date();
    await row.save();

    if (row.customerEmail) {
        try {
            const { createEmailTransporter, mailerReady, renderEmail, EMAIL_FROM, PORTAL_URL }
                = require('../../utils/mailer');
            if (mailerReady()) {
                await createEmailTransporter().sendMail({
                    from: EMAIL_FROM,
                    to: row.customerEmail,
                    subject: action === 'approve'
                        ? 'Approved — start now, pay when you finish'
                        : 'About your request to pay after completion',
                    html: renderEmail({
                        heading: action === 'approve' ? 'You can continue without paying now' : 'Request not approved',
                        name: row.customerName || '',
                        bodyHtml: action === 'approve'
                            ? `<p>HR read your request and approved it. <b>${escapeText(row.description || 'Your course')}</b>
                               is open in your portal right now — go and start. Nothing else waits for the fee;
                               only your certificate does, and that is ₹${row.amount} when you get there.</p>`
                            + '<p style="margin-top:10px;">Just check your portal — it is already there.</p>'
                            : `<p>HR read your request and could not approve paying after completion this time.
                               You can start straight away by paying ₹${escapeText(String(
                                   (studioPricing.getProduct(studioPricing.productKeyFromPurpose(row.purpose)) || {}).price
                                   || row.amount))} now — that is the cheaper price, and it opens immediately.</p>`
                            + (note ? `<p style="margin-top:10px;"><b>From HR:</b> ${escapeText(note)}</p>` : ''),
                        cta: action === 'approve'
                            ? { label: 'Open my portal →', url: PORTAL_URL + '/learn' }
                            : { label: 'Pay and start →', url: PORTAL_URL + '/studio.html' },
                        footerWhy: 'You are receiving this because you asked to pay for TEN after completion.'
                    })
                });
            }
        } catch (err) { console.error('[studio] deferral decision mail failed:', err.message); }
    }

    res.json({ success: true, status: action === 'approve' ? 'approved' : 'rejected' });
}));

module.exports = router;
