'use strict';

/**
 * @fileoverview Abstract base class defining the contract all payment
 * providers must follow. Phase 1 — Setu implementation in PaymentSetuProvider.
 */

const STATUSES = Object.freeze({
  CREATED:             'CREATED',
  PENDING:             'PENDING',
  PAID:                'PAID',
  FAILED:              'FAILED',
  REFUNDED:            'REFUNDED',
  PARTIALLY_REFUNDED:  'PARTIALLY_REFUNDED',
});

/**
 * @abstract
 */
class PaymentService {
  /**
   * Create a payment order with the provider.
   * @param {{ amount: number, currency: string, description: string, metadata: object }} params
   * @returns {Promise<{ success: boolean, orderId: string, providerOrderId: string, amount: number, currency: string, status: string }>}
   */
  async createOrder(params) { // eslint-disable-line no-unused-vars
    throw new Error('createOrder() must be implemented by subclass');
  }

  /**
   * Verify a payment signature / status from the provider.
   * @param {{ orderId: string, providerPaymentId: string, signature: string }} params
   * @returns {Promise<{ success: boolean, verified: boolean, message: string }>}
   */
  async verifyPayment(params) { // eslint-disable-line no-unused-vars
    throw new Error('verifyPayment() must be implemented by subclass');
  }

  /**
   * Request a full or partial refund.
   * @param {{ transactionId: string, amount: number, reason: string }} params
   * @returns {Promise<{ success: boolean, refundId: string, status: string, message: string }>}
   */
  async refundPayment(params) { // eslint-disable-line no-unused-vars
    throw new Error('refundPayment() must be implemented by subclass');
  }

  /**
   * Fetch live transaction status from the provider.
   * @param {{ transactionId: string }} params
   * @returns {Promise<{ success: boolean, status: string, amount: number, currency: string, createdAt: string, metadata: object }>}
   */
  async getTransactionStatus(params) { // eslint-disable-line no-unused-vars
    throw new Error('getTransactionStatus() must be implemented by subclass');
  }
}

module.exports = { PaymentService, STATUSES };
