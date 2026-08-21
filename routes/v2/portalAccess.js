'use strict';

/**
 * @fileoverview Real, verified payment for portal access.
 *
 * The paygate used to trust the browser: it showed a static UPI QR, and
 * pressing "Pay Now" set a localStorage flag. A static QR cannot be verified —
 * nothing ties a rupee that lands in the merchant account to the person who
 * clicked, so the flag was a promise, not a receipt.
 *
 * This routes access through the Setu integration already in the repo, which
 * has the one thing a static QR lacks: a per-order id the provider reports
 * back on. The order is created here, the QR encodes that order's payment
 * link, and PaymentWebhookService flips the transaction to PAID when Setu says
 * so — with an HMAC-checked signature. Access is then a database question
 * ("does this user have a PAID transaction for this portal?") rather than a
 * browser one.
 *
 * Two things are deliberate:
 *
 * The price is set here, never taken from the request. A client that could
 * name its own amount could buy a 200-rupee portal for one rupee.
 *
 * Everything requires a logged-in user. An entitlement has to belong to
 * somebody — anonymous access could not survive a cleared browser, and an
 * unauthenticated order endpoint is a spam target.
 */

const express = require('express');
const QRCode = require('qrcode');

const PaymentSetuProvider = require('../../services/payment/PaymentSetuProvider');
const PaymentTransaction = require('../../models/PaymentTransaction');
const paymentConfig = require('../../config/payment');
const { requireRole } = require('../../middleware/roleGuard');
const { ALL_ROLES } = require('../../config/roles');

const router = express.Router();
const provider = new PaymentSetuProvider();

/** Portals that can be bought. Anything else is rejected rather than created. */
const PORTALS = Object.freeze({
  student: 'TEN Student Portal access',
  academics: 'TEN Academics access',
  job: 'TEN Job Portal access',
  resume: 'TEN Resume Builder access',
  hackathon: 'TEN Hackathon & Ideathon access'
});

/**
 * Whether real payment can run at all. Without credentials the provider would
 * produce orders nobody can pay, so the caller is told plainly and the
 * frontend keeps its unverified fallback instead of showing a dead QR.
 */
function paymentLive() {
  return Boolean(
    paymentConfig.PAYMENT_ENABLED &&
    process.env.SETU_CLIENT_ID &&
    process.env.SETU_CLIENT_SECRET
  );
}

/** A PAID transaction for this user and portal is the entitlement. */
async function isEntitled(userId, portal) {
  const paid = await PaymentTransaction.findOne({
    initiatedBy: userId,
    status: 'PAID',
    'metadata.portal': portal
  }).select('_id').lean();
  return Boolean(paid);
}

/**
 * GET /api/v2/portal-access/:portal
 * Does the signed-in user already own this portal?
 */
router.get('/:portal', requireRole(...ALL_ROLES), async (req, res) => {
  const portal = String(req.params.portal || '');
  if (!PORTALS[portal]) {
    return res.status(400).json({ success: false, error: 'Unknown portal.' });
  }

  try {
    return res.json({
      success: true,
      portal,
      granted: await isEntitled(req.user._id, portal),
      live: paymentLive(),
      price: paymentConfig.PORTAL_ACCESS_PRICE
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'Could not check access.' });
  }
});

/**
 * POST /api/v2/portal-access/order
 * Create an order for one portal and return a QR that pays that order.
 */
router.post('/order', requireRole(...ALL_ROLES), async (req, res) => {
  const portal = String((req.body && req.body.portal) || '');
  if (!PORTALS[portal]) {
    return res.status(400).json({ success: false, error: 'Unknown portal.' });
  }

  if (!paymentLive()) {
    return res.status(503).json({
      success: false,
      live: false,
      error: 'Online payment is not configured on this server.'
    });
  }

  /* Already paid: hand back the entitlement rather than charging twice. */
  try {
    if (await isEntitled(req.user._id, portal)) {
      return res.json({ success: true, alreadyPaid: true, portal });
    }
  } catch (err) {
    return res.status(500).json({ success: false, error: 'Could not check access.' });
  }

  const rupees = paymentConfig.PORTAL_ACCESS_PRICE;

  try {
    /* Setu bill amounts are in paise. Sending rupees here would charge a
       hundredth of the price and still report success. */
    const order = await provider.createOrder({
      amount: rupees * 100,
      currency: 'INR',
      description: PORTALS[portal],
      metadata: { portal, userId: String(req.user._id) }
    });

    if (!order.success || !order.paymentUrl) {
      return res.status(502).json({
        success: false,
        error: order.error || 'Could not create the payment order.'
      });
    }

    const txn = await PaymentTransaction.create({
      provider: 'setu',
      providerOrderId: order.providerOrderId,
      amount: rupees,
      currency: 'INR',
      description: PORTALS[portal],
      status: 'CREATED',
      initiatedBy: req.user._id,
      metadata: { portal }
    });

    /* The QR encodes this order's link, which is the whole point: scanning it
       pays a bill the provider can report back on. */
    const qrDataUri = await QRCode.toDataURL(order.paymentUrl, {
      width: 480, margin: 1, errorCorrectionLevel: 'M'
    });

    return res.status(201).json({
      success: true,
      live: true,
      orderId: String(txn._id),
      paymentUrl: order.paymentUrl,
      qr: qrDataUri,
      amount: rupees,
      portal
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'Payment initiation failed.' });
  }
});

/**
 * GET /api/v2/portal-access/order/:id/status
 * Polled by the paygate while the QR is on screen.
 *
 * The webhook is what normally marks a transaction PAID. This also asks the
 * provider directly, because a webhook that is delayed, retried, or blocked by
 * a misconfigured URL would otherwise leave a paying user staring at a QR they
 * have already settled.
 */
router.get('/order/:id/status', requireRole(...ALL_ROLES), async (req, res) => {
  try {
    const txn = await PaymentTransaction.findById(req.params.id);
    if (!txn) {
      return res.status(404).json({ success: false, error: 'Order not found.' });
    }
    /* Someone else's order is not yours to read or to be granted by. */
    if (String(txn.initiatedBy) !== String(req.user._id)) {
      return res.status(403).json({ success: false, error: 'Not your order.' });
    }

    if (txn.status !== 'PAID' && txn.providerOrderId && paymentLive()) {
      const check = await provider.verifyPayment({
        orderId: txn.providerOrderId, providerPaymentId: '', signature: ''
      });
      if (check.verified) {
        txn.status = 'PAID';
        await txn.save();
      }
    }

    return res.json({
      success: true,
      status: txn.status,
      granted: txn.status === 'PAID',
      portal: txn.metadata ? txn.metadata.get('portal') : undefined
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'Could not check the order.' });
  }
});

module.exports = router;
module.exports.PORTALS = PORTALS;
