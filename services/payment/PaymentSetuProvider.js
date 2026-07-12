'use strict';

/**
 * @fileoverview PaymentSetu (setu.co) implementation of PaymentService.
 * All credentials are read from environment variables — never hardcoded.
 */

const https   = require('https');
const http    = require('http');
const { PaymentService, STATUSES } = require('./PaymentService');

const MAX_RETRIES     = 3;
const RETRY_DELAY_MS  = 500;

/**
 * Simple promise-based HTTP/S request (avoids adding new dependencies).
 * @param {string} url
 * @param {{ method: string, headers: object, body?: string }} options
 * @returns {Promise<{ status: number, data: object }>}
 */
function httpRequest(url, options) {
  return new Promise((resolve, reject) => {
    const parsed   = new URL(url);
    const lib      = parsed.protocol === 'https:' ? https : http;
    const reqOpts  = {
      hostname: parsed.hostname,
      port:     parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path:     parsed.pathname + parsed.search,
      method:   options.method || 'GET',
      headers:  options.headers || {},
    };

    const req = lib.request(reqOpts, (res) => {
      let raw = '';
      res.on('data', (chunk) => { raw += chunk; });
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(raw) });
        } catch (parseErr) {
          resolve({ status: res.statusCode, data: { raw } });
        }
      });
    });

    req.on('error', reject);

    if (options.body) {
      req.write(options.body);
    }
    req.end();
  });
}

/**
 * Wait for ms milliseconds.
 * @param {number} ms
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise((resolve) => { setTimeout(resolve, ms); });
}

class PaymentSetuProvider extends PaymentService {
  constructor() {
    super();
    this.clientId     = process.env.SETU_CLIENT_ID     || '';
    this.clientSecret = process.env.SETU_CLIENT_SECRET || '';
    this.schemeId     = process.env.SETU_SCHEME_ID     || '';
    this.baseUrl      = process.env.SETU_BASE_URL      || 'https://prod.setu.co/api';
  }

  /**
   * Build standard request headers for Setu API.
   * @returns {object}
   */
  _buildHeaders() {
    const credentials = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64');
    return {
      'Content-Type':  'application/json',
      'Authorization': `Basic ${credentials}`,
      'x-setu-client-id': this.clientId,
    };
  }

  /**
   * Perform an HTTP request with retry on network errors.
   * @param {string} endpoint
   * @param {{ method: string, body?: object }} opts
   * @returns {Promise<{ status: number, data: object }>}
   */
  async _request(endpoint, opts) {
    const url     = `${this.baseUrl}${endpoint}`;
    const options = {
      method:  opts.method,
      headers: this._buildHeaders(),
      body:    opts.body ? JSON.stringify(opts.body) : undefined,
    };

    const start = new Date().toISOString();
    let lastErr;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const result = await httpRequest(url, options);
        console.error(`[PaymentSetu] ${start} ${opts.method} ${endpoint} -> ${result.status}`);
        return result;
      } catch (err) {
        lastErr = err;
        console.error(`[PaymentSetu] Attempt ${attempt} failed: ${err.message}`);
        if (attempt < MAX_RETRIES) {
          await sleep(RETRY_DELAY_MS * attempt);
        }
      }
    }

    throw lastErr;
  }

  async createOrder({ amount, currency = 'INR', description = '', metadata = {} }) {
    try {
      const result = await this._request('/payment-links', {
        method: 'POST',
        body:   {
          amount: { currencyCode: currency, value: amount },
          amountExactness: 'EXACT',
          billerBillID: `TEN-${Date.now()}`,
          name:    description,
          schemeID: this.schemeId,
          additionalInfo: metadata,
        },
      });

      if (result.status === 200 || result.status === 201) {
        const d = result.data;
        return {
          success:         true,
          orderId:         d.platformBillID || d.id || '',
          providerOrderId: d.platformBillID || '',
          paymentUrl:      d.shortURL || d.paymentLink || '',
          amount,
          currency,
          status:          STATUSES.CREATED,
        };
      }

      return { success: false, error: result.data.message || 'Order creation failed', status: STATUSES.FAILED };
    } catch (err) {
      return { success: false, error: err.message, status: STATUSES.FAILED };
    }
  }

  async verifyPayment({ orderId, providerPaymentId, signature }) { // eslint-disable-line no-unused-vars
    try {
      const result = await this._request(`/payment-links/${orderId}`, { method: 'GET' });

      if (result.status === 200) {
        const paid = result.data.status === 'BILL_FULFILLED';
        return {
          success:  true,
          verified: paid,
          message:  paid ? 'Payment verified' : 'Payment not yet completed',
          rawStatus: result.data.status,
        };
      }

      return { success: false, verified: false, message: 'Could not verify with provider' };
    } catch (err) {
      return { success: false, verified: false, message: err.message };
    }
  }

  async refundPayment({ transactionId, amount, reason = '' }) {
    try {
      const result = await this._request('/refunds', {
        method: 'POST',
        body:   { txnID: transactionId, refundAmount: amount, reason },
      });

      if (result.status === 200 || result.status === 201) {
        return {
          success:  true,
          refundId: result.data.refundID || '',
          status:   STATUSES.REFUNDED,
          message:  'Refund initiated',
        };
      }

      return { success: false, refundId: '', status: STATUSES.FAILED, message: result.data.message || 'Refund failed' };
    } catch (err) {
      return { success: false, refundId: '', status: STATUSES.FAILED, message: err.message };
    }
  }

  async getTransactionStatus({ transactionId }) {
    try {
      const result = await this._request(`/payment-links/${transactionId}`, { method: 'GET' });

      if (result.status === 200) {
        const d = result.data;
        return {
          success:   true,
          status:    d.status === 'BILL_FULFILLED' ? STATUSES.PAID : STATUSES.PENDING,
          amount:    d.amount ? d.amount.value : 0,
          currency:  d.amount ? d.amount.currencyCode : 'INR',
          createdAt: d.createdAt || '',
          metadata:  d.additionalInfo || {},
        };
      }

      return { success: false, status: STATUSES.FAILED, amount: 0, currency: 'INR', createdAt: '', metadata: {} };
    } catch (err) {
      return { success: false, status: STATUSES.FAILED, amount: 0, currency: 'INR', createdAt: '', metadata: {}, error: err.message };
    }
  }
}

module.exports = PaymentSetuProvider;
