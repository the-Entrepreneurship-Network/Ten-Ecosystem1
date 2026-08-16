'use strict';

const crypto = require('crypto');

jest.mock('../../../models/PaymentTransaction', () => ({
  PAYMENT_STATUSES: { CREATED: 'CREATED', PENDING: 'PENDING', PAID: 'PAID', FAILED: 'FAILED', REFUNDED: 'REFUNDED' },
  findOne: jest.fn(),
  findById: jest.fn(),
}));

const { verifyWebhookSignature, webhookEmitter } = require('../../../services/payment/PaymentWebhookService');

describe('services/payment/PaymentWebhookService', () => {
  const SECRET = 'webhook-test-key';
  const RAW_BODY = '{"event":"payment.captured","payload":{}}';

  function sign(body, key) {
    return crypto.createHmac('sha256', key).update(body).digest('hex');
  }

  describe('verifyWebhookSignature', () => {
    it('returns true for a valid HMAC-SHA256 signature', () => {
      expect(verifyWebhookSignature({ rawBody: RAW_BODY, signature: sign(RAW_BODY, SECRET), secret: SECRET })).toBe(true);
    });

    it('returns false for an invalid signature', () => {
      expect(verifyWebhookSignature({ rawBody: RAW_BODY, signature: 'a'.repeat(64), secret: SECRET })).toBe(false);
    });

    it.each([
      ['secret', { rawBody: RAW_BODY, signature: 'abc', secret: '' }],
      ['signature', { rawBody: RAW_BODY, signature: '', secret: SECRET }],
      ['rawBody', { rawBody: '', signature: 'abc', secret: SECRET }],
    ])('returns false when %s is missing', (_label, params) => {
      expect(verifyWebhookSignature(params)).toBe(false);
    });

    it('works with a Buffer rawBody', () => {
      const buf = Buffer.from(RAW_BODY, 'utf8');
      expect(verifyWebhookSignature({ rawBody: buf, signature: sign(RAW_BODY, SECRET), secret: SECRET })).toBe(true);
    });

    it('returns false for signature with wrong length', () => {
      expect(verifyWebhookSignature({ rawBody: RAW_BODY, signature: 'short', secret: SECRET })).toBe(false);
    });
  });

  describe('webhookEmitter', () => {
    it('is an EventEmitter instance', () => {
      expect(webhookEmitter).toBeInstanceOf(require('events').EventEmitter);
    });

    it('can emit and listen for webhook events', (done) => {
      const payload = { event: 'test', data: 123 };
      webhookEmitter.once('webhook', (received) => {
        expect(received).toEqual(payload);
        done();
      });
      webhookEmitter.emit('webhook', payload);
    });
  });
});
