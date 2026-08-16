'use strict';

/**
 * @fileoverview PaymentSetu API controller.
 * Uses the isolated PaymentSetuProvider — does NOT touch existing payment routes.
 */

const PaymentSetuProvider     = require('../services/payment/PaymentSetuProvider');
const { verifyWebhookSignature, processWebhookEvent } = require('../services/payment/PaymentWebhookService');
const PaymentTransaction      = require('../models/PaymentTransaction');

const setuProvider = new PaymentSetuProvider();

/**
 * POST /api/payment/setu/initiate
 */
async function initiatePayment(req, res) {
  try {
    const { amount, description } = req.body;

    if (!amount || typeof amount !== 'number' || amount <= 0) {
      return res.status(400).json({ success: false, error: 'amount must be a positive number.' });
    }
    if (!description || typeof description !== 'string') {
      return res.status(400).json({ success: false, error: 'description is required.' });
    }

    const orderResult = await setuProvider.createOrder({ amount, currency: 'INR', description });

    if (!orderResult.success) {
      return res.status(502).json({ success: false, error: orderResult.error || 'Provider error.' });
    }

    const txn = await PaymentTransaction.create({
      provider:        'setu',
      providerOrderId: orderResult.providerOrderId,
      amount,
      currency:        'INR',
      description,
      status:          'CREATED',
      initiatedBy:     req.user ? req.user._id : null,
    });

    return res.status(201).json({
      success:    true,
      orderId:    txn._id,
      paymentUrl: orderResult.paymentUrl,
      amount,
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'Payment initiation failed.' });
  }
}

/**
 * POST /api/payment/setu/verify
 */
async function verifyPayment(req, res) {
  try {
    const { orderId, providerPaymentId, signature } = req.body;

    if (!orderId) {
      return res.status(400).json({ success: false, error: 'orderId is required.' });
    }

    const txn = await PaymentTransaction.findById(orderId);
    if (!txn) {
      return res.status(404).json({ success: false, error: 'Transaction not found.' });
    }

    const result = await setuProvider.verifyPayment({
      orderId:          txn.providerOrderId,
      providerPaymentId: providerPaymentId || '',
      signature:        signature || '',
    });

    if (result.verified) {
      txn.status            = 'PAID';
      txn.providerPaymentId = providerPaymentId || '';
      await txn.save();
    }

    return res.status(200).json({ success: true, verified: result.verified, status: txn.status });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'Verification failed.' });
  }
}

/**
 * POST /api/payment/setu/webhook
 * Must use express.raw() — raw body preserved for HMAC check.
 */
async function handleWebhook(req, res) {
  try {
    const signature = req.headers['x-setu-signature'] || '';
    const secret    = process.env.SETU_WEBHOOK_SECRET || '';

    const isValid = verifyWebhookSignature({ rawBody: req.body, signature, secret });

    if (!isValid) {
      return res.status(401).json({ success: false, error: 'Invalid webhook signature.' });
    }

    const payload = JSON.parse(req.body.toString('utf8'));
    const event   = payload.event || '';

    setImmediate(() => {
      processWebhookEvent({ event, payload }).catch((err) => {
        console.error('[Webhook] processWebhookEvent error:', err.message);
      });
    });

    return res.status(200).json({ success: true });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'Webhook processing error.' });
  }
}

/**
 * GET /api/payment/setu/status/:id
 */
async function getTransactionStatus(req, res) {
  try {
    const txn = await PaymentTransaction.findById(req.params.id)
      .select('-webhookEvents -__v')
      .lean();

    if (!txn) {
      return res.status(404).json({ success: false, error: 'Transaction not found.' });
    }

    return res.status(200).json({ success: true, transaction: txn });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'Could not fetch transaction.' });
  }
}

/**
 * GET /api/payment/setu/my-transactions
 */
async function getUserTransactions(req, res) {
  try {
    const page  = Math.max(1, parseInt(req.query.page, 10)  || 1);
    const limit = Math.min(50, parseInt(req.query.limit, 10) || 10);
    const skip  = (page - 1) * limit;

    const [transactions, total] = await Promise.all([
      PaymentTransaction.find({ initiatedBy: req.user._id })
        .select('-webhookEvents -__v')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      PaymentTransaction.countDocuments({ initiatedBy: req.user._id }),
    ]);

    return res.status(200).json({
      success:    true,
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
      transactions,
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'Could not fetch transactions.' });
  }
}

module.exports = { initiatePayment, verifyPayment, handleWebhook, getTransactionStatus, getUserTransactions };
