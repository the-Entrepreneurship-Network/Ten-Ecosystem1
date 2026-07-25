'use strict';

/**
 * @fileoverview Setu webhook signature verification and event processing.
 */

const crypto           = require('crypto');
const { EventEmitter } = require('events');
const PaymentTransaction = require('../../models/PaymentTransaction');
const { PAYMENT_STATUSES } = PaymentTransaction;

const EVENT_STATUS_MAP = Object.freeze({
  'payment.captured': 'PAID',
  'payment.failed':   'FAILED',
  'payment.refunded': 'REFUNDED',
});

const webhookEmitter = new EventEmitter();

/**
 * Verify inbound Setu webhook HMAC-SHA256 signature.
 * @param {{ rawBody: Buffer|string, signature: string, secret: string }} params
 * @returns {boolean}
 */
function verifyWebhookSignature({ rawBody, signature, secret }) {
  if (!secret || !signature || !rawBody) return false;

  const expected = crypto
    .createHmac('sha256', secret)
    .update(typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8'))
    .digest('hex');

  try {
    return crypto.timingSafeEqual(
      Buffer.from(expected, 'hex'),
      Buffer.from(signature,  'hex'),
    );
  } catch (_err) {
    return false;
  }
}

/**
 * Process a verified webhook event and update PaymentTransaction record.
 * @param {{ event: string, payload: object }} params
 * @returns {Promise<void>}
 */
async function processWebhookEvent({ event, payload }) {
  const newStatus = EVENT_STATUS_MAP[event];
  const providerOrderId = (payload && (payload.platformBillID || payload.orderId)) || '';

  if (providerOrderId && newStatus) {
    const txn = await PaymentTransaction.findOne({ providerOrderId });
    if (txn) {
      txn.status = newStatus;
      txn.webhookEvents.push({ event, payload, receivedAt: new Date() });
      await txn.save();
    }
  }

  webhookEmitter.emit('webhook', { event, payload, newStatus });
}

/**
 * Get webhook event history for a transaction.
 * @param {{ transactionId: string }} params
 * @returns {Promise<Array>}
 */
async function getEventHistory({ transactionId }) {
  const txn = await PaymentTransaction.findById(transactionId).select('webhookEvents').lean();
  return txn ? txn.webhookEvents : [];
}

module.exports = { verifyWebhookSignature, processWebhookEvent, getEventHistory, webhookEmitter };
