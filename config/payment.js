// NEW FEATURE: Payment Skeleton — PAYMENT_ENABLED=false by default
// Set PAYMENT_ENABLED=true in .env to activate everything with zero code changes.

const expert_price = 100;
const nano_price = 1000;
const fellowship_price = 2500;

const BUSINESS_UPI = {
  upiId: 'paytmqr5k0ods@ptys',
  payeeName: 'Limitless Technologies',
  phone: '8595986120'
};

// What a run of any portal costs, in rupees. The same figure for all of them
// today; the paygate takes a per-portal data-amount if that ever changes, but
// the shared QR encodes this one, so a portal priced differently needs its own
// QR rather than just a different attribute.
const PORTAL_ACCESS_PRICE = 200;

const FINE_AMOUNTS = {
  low_attendance: 400
};

module.exports = {
    PAYMENT_ENABLED: process.env.PAYMENT_ENABLED === 'true' || false,
    RAZORPAY_KEY_ID: process.env.RAZORPAY_KEY_ID || '',
    RAZORPAY_KEY_SECRET: process.env.RAZORPAY_KEY_SECRET || '',
    CERT_PRICES: {
        expert: expert_price,
        nano_degree: nano_price,
        fellowship: fellowship_price
    },
    CERT_PRICES_PAISE: {
        expert: expert_price * 100,
        nano_degree: nano_price * 100,
        fellowship: fellowship_price * 100
    },
    PAYMENT_SETU_API_KEY: process.env.PAYMENTSETU_API_KEY || '',
    PAYMENTSETU_BASE_URL: process.env.PAYMENTSETU_BASE_URL || 'https://paymentsetu.com/api',
    BUSINESS_UPI,
    PORTAL_ACCESS_PRICE,
    FINE_AMOUNTS
};

// All payment execution wrapped like this:
// async function claimCertificate(studentId, certType) {
//   const config = require('./payment');
//   if (!config.PAYMENT_ENABLED) {
//     return { status: 'payment_disabled', message: 'Payment coming soon. You will be notified by email.' }
//   }
//   // Full Razorpay payment code runs ONLY when flag is true
// }
