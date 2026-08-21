'use strict';

/**
 * Portal access is a money path, so the tests here are about the ways it could
 * hand out access nobody paid for, or charge the wrong amount.
 */

const express = require('express');
const request = require('supertest');

jest.mock('../../middleware/roleGuard', () => ({
  requireRole: () => (req, res, next) => {
    if (!req.headers['x-test-user']) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }
    req.user = { _id: req.headers['x-test-user'] };
    next();
  }
}));

const mockCreateOrder = jest.fn();
const mockVerify = jest.fn();
jest.mock('../../services/payment/PaymentSetuProvider', () =>
  jest.fn().mockImplementation(() => ({
    createOrder: mockCreateOrder,
    verifyPayment: mockVerify
  })));

const mockFindOne = jest.fn();
const mockCreate = jest.fn();
const mockFindById = jest.fn();
jest.mock('../../models/PaymentTransaction', () => ({
  findOne: (...a) => mockFindOne(...a),
  create: (...a) => mockCreate(...a),
  findById: (...a) => mockFindById(...a)
}));

const USER = '507f1f77bcf86cd799439011';
const OTHER = '507f1f77bcf86cd799439099';

function app() {
  const a = express();
  a.use(express.json());
  a.use('/api/v2/portal-access', require('../../routes/v2/portalAccess'));
  return a;
}

function noEntitlement() {
  mockFindOne.mockReturnValue({ select: () => ({ lean: async () => null }) });
}
function hasEntitlement() {
  mockFindOne.mockReturnValue({ select: () => ({ lean: async () => ({ _id: 'x' }) }) });
}

describe('portal access', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.PAYMENT_ENABLED = 'true';
    process.env.SETU_CLIENT_ID = 'id';
    process.env.SETU_CLIENT_SECRET = 'secret';
    jest.resetModules();
  });

  describe('authentication', () => {
    it('refuses to create an order for an anonymous visitor', async () => {
      const res = await request(app()).post('/api/v2/portal-access/order').send({ portal: 'job' });
      expect(res.status).toBe(401);
      expect(mockCreate).not.toHaveBeenCalled();
    });
  });

  describe('order creation', () => {
    it('charges the configured price regardless of what the client asks for', async () => {
      noEntitlement();
      mockCreateOrder.mockResolvedValue({
        success: true, providerOrderId: 'setu-1', paymentUrl: 'https://pay.setu/abc'
      });
      mockCreate.mockResolvedValue({ _id: 'txn-1' });

      const res = await request(app())
        .post('/api/v2/portal-access/order')
        .set('x-test-user', USER)
        .send({ portal: 'job', amount: 1 });     // a client trying to set its own price

      expect(res.status).toBe(201);
      // Setu takes paise: 200 rupees must go over the wire as 20000.
      expect(mockCreateOrder).toHaveBeenCalledWith(
        expect.objectContaining({ amount: 20000, currency: 'INR' })
      );
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({ amount: 200, status: 'CREATED', initiatedBy: USER })
      );
    });

    it('returns a QR that encodes the order, not a static merchant code', async () => {
      noEntitlement();
      mockCreateOrder.mockResolvedValue({
        success: true, providerOrderId: 'setu-1', paymentUrl: 'https://pay.setu/abc'
      });
      mockCreate.mockResolvedValue({ _id: 'txn-1' });

      const res = await request(app())
        .post('/api/v2/portal-access/order').set('x-test-user', USER).send({ portal: 'job' });

      expect(res.body.qr).toMatch(/^data:image\/png;base64,/);
      expect(res.body.paymentUrl).toBe('https://pay.setu/abc');
    });

    it('rejects a portal that is not on the list', async () => {
      const res = await request(app())
        .post('/api/v2/portal-access/order').set('x-test-user', USER).send({ portal: 'admin' });
      expect(res.status).toBe(400);
      expect(mockCreateOrder).not.toHaveBeenCalled();
    });

    it('does not charge again when the portal is already owned', async () => {
      hasEntitlement();
      const res = await request(app())
        .post('/api/v2/portal-access/order').set('x-test-user', USER).send({ portal: 'job' });
      expect(res.body.alreadyPaid).toBe(true);
      expect(mockCreateOrder).not.toHaveBeenCalled();
    });

    it('reports payment unavailable instead of creating an unpayable order', async () => {
      delete process.env.SETU_CLIENT_ID;
      const res = await request(app())
        .post('/api/v2/portal-access/order').set('x-test-user', USER).send({ portal: 'job' });
      expect(res.status).toBe(503);
      expect(res.body.live).toBe(false);
      expect(mockCreateOrder).not.toHaveBeenCalled();
    });
  });

  describe('order status', () => {
    it("will not report on somebody else's order", async () => {
      mockFindById.mockResolvedValue({ _id: 'txn-1', initiatedBy: OTHER, status: 'PAID' });
      const res = await request(app())
        .get('/api/v2/portal-access/order/txn-1/status').set('x-test-user', USER);
      expect(res.status).toBe(403);
      expect(res.body.granted).toBeUndefined();
    });

    it('grants only once the provider confirms the payment', async () => {
      const save = jest.fn();
      mockFindById.mockResolvedValue({
        _id: 'txn-1', initiatedBy: USER, status: 'CREATED',
        providerOrderId: 'setu-1', metadata: new Map([['portal', 'job']]), save
      });
      mockVerify.mockResolvedValue({ verified: false });

      let res = await request(app())
        .get('/api/v2/portal-access/order/txn-1/status').set('x-test-user', USER);
      expect(res.body.granted).toBe(false);
      expect(save).not.toHaveBeenCalled();

      mockVerify.mockResolvedValue({ verified: true });
      res = await request(app())
        .get('/api/v2/portal-access/order/txn-1/status').set('x-test-user', USER);
      expect(res.body.granted).toBe(true);
      expect(save).toHaveBeenCalled();
    });
  });

  describe('entitlement', () => {
    it('grants access when a PAID transaction exists for that portal', async () => {
      hasEntitlement();
      const res = await request(app()).get('/api/v2/portal-access/job').set('x-test-user', USER);
      expect(res.body.granted).toBe(true);
      expect(mockFindOne).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'PAID', 'metadata.portal': 'job' })
      );
    });

    it('withholds access when there is no paid transaction', async () => {
      noEntitlement();
      const res = await request(app()).get('/api/v2/portal-access/job').set('x-test-user', USER);
      expect(res.body.granted).toBe(false);
    });
  });
});
