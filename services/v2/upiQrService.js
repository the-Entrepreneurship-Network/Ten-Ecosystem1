'use strict';

const QRCode = require('qrcode');

class UpiQrService {
  /**
   * Generates a standard UPI deep link URL.
   * Format: upi://pay?pa=UPI_ID&pn=PAYEE_NAME&am=AMOUNT&cu=INR&tn=TRANSACTION_NOTE&tr=TRANSACTION_REF
   */
  generateUpiLink({ upiId, payeeName, amount, note, transactionId }) {
    const pa = encodeURIComponent(upiId || process.env.UPI_ID || '8595986120@ptyes');
    const pn = encodeURIComponent(payeeName || 'The Entrepreneurship Network');
    const am = encodeURIComponent(amount);
    const cu = 'INR';
    const tn = encodeURIComponent(note || 'TEN Internship Payment');
    const tr = encodeURIComponent(transactionId);

    return `upi://pay?pa=${pa}&pn=${pn}&am=${am}&cu=${cu}&tn=${tn}&tr=${tr}`;
  }

  /**
   * Generates a Base64 QR code image from the UPI link.
   */
  async generateQrCodeDataUrl(upiLink) {
    try {
      const dataUrl = await QRCode.toDataURL(upiLink, {
        errorCorrectionLevel: 'M',
        margin: 2,
        width: 300,
        color: {
          dark: '#0e1428', // Elegant dark color matching our theme
          light: '#ffffff'
        }
      });
      return dataUrl;
    } catch (err) {
      console.error('[UpiQrService] QR code generation failed:', err.message);
      throw err;
    }
  }
}

module.exports = new UpiQrService();
