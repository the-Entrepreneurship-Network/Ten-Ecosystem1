'use strict';

const PaymentSetuProvider = require('../payment/PaymentSetuProvider');
const upiQrService = require('./upiQrService');

class PaymentProviderHub {
  constructor() {
    this.providers = {
      setu: new PaymentSetuProvider(),
    };
  }

  /**
   * Get the active or specific gateway provider.
   */
  getProvider(name) {
    const providerName = name || (process.env.PAYMENT_PROVIDER || 'setu');
    return this.providers[providerName];
  }

  /**
   * Generate a Manual UPI QR and return instruction structure.
   */
  async generateManualUpiPayment({ amount, orderId, purpose }) {
    const upiId = process.env.UPI_ID || '8595986120@ptyes';
    const payeeName = 'The Entrepreneurship Network';
    
    // Build standard UPI URI
    const upiLink = upiQrService.generateUpiLink({
      upiId,
      payeeName,
      amount,
      note: purpose,
      transactionId: orderId
    });

    const qrCodeDataUrl = await upiQrService.generateQrCodeDataUrl(upiLink);

    return {
      success: true,
      provider: 'upi',
      orderId,
      amount,
      currency: 'INR',
      upiId,
      payeeName,
      upiLink,
      qrCodeDataUrl,
      instructions: `Please scan this QR code using any UPI app (PhonePe, Google Pay, Paytm, BHIM, etc.) to pay exactly ₹${amount}. Once paid, you must enter your 12-digit transaction UTR / UPI Ref number below to submit for HR manual approval. Your payment will be verified and approved by HR within 24–48 hours.`
    };
  }
}

module.exports = new PaymentProviderHub();
