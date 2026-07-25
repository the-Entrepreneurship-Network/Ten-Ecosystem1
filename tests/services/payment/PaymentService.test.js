'use strict';

const { PaymentService, STATUSES } = require('../../../services/payment/PaymentService');

describe('services/payment/PaymentService', () => {
  describe('STATUSES', () => {
    it('contains all expected payment statuses', () => {
      expect(STATUSES.CREATED).toBe('CREATED');
      expect(STATUSES.PENDING).toBe('PENDING');
      expect(STATUSES.PAID).toBe('PAID');
      expect(STATUSES.FAILED).toBe('FAILED');
      expect(STATUSES.REFUNDED).toBe('REFUNDED');
      expect(STATUSES.PARTIALLY_REFUNDED).toBe('PARTIALLY_REFUNDED');
    });

    it('is frozen', () => {
      expect(Object.isFrozen(STATUSES)).toBe(true);
    });

    it('has exactly 6 statuses', () => {
      expect(Object.keys(STATUSES)).toHaveLength(6);
    });
  });

  describe('PaymentService abstract class', () => {
    let service;

    beforeEach(() => {
      service = new PaymentService();
    });

    it('throws on createOrder()', async () => {
      await expect(service.createOrder({})).rejects.toThrow('must be implemented');
    });

    it('throws on verifyPayment()', async () => {
      await expect(service.verifyPayment({})).rejects.toThrow('must be implemented');
    });

    it('throws on refundPayment()', async () => {
      await expect(service.refundPayment({})).rejects.toThrow('must be implemented');
    });

    it('throws on getTransactionStatus()', async () => {
      await expect(service.getTransactionStatus({})).rejects.toThrow('must be implemented');
    });
  });
});
