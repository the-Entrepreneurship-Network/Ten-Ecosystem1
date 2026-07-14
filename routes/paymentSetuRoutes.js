'use strict';

const express      = require('express');
const ctrl         = require('../controllers/paymentSetuController');
const { requireRole } = require('../middleware/roleGuard');
const { ALL_ROLES }   = require('../config/roles');

const rateLimit = require("express-rate-limit");
const paymentLimiter = rateLimit({
    windowMs: process.env.RATE_PAYMENT_WINDOW_MS
      ? parseInt(process.env.RATE_PAYMENT_WINDOW_MS)
      : 60 * 60 * 1000,
    max: process.env.RATE_PAYMENT_MAX
      ? parseInt(process.env.RATE_PAYMENT_MAX)
      : 20,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, message: "Too many payment requests. Please try again later." }
});

const router = express.Router();
router.use(paymentLimiter);

router.post('/initiate',       requireRole(...ALL_ROLES), ctrl.initiatePayment);
router.post('/verify',         requireRole(...ALL_ROLES), ctrl.verifyPayment);
router.post('/webhook',        express.raw({ type: 'application/json' }), ctrl.handleWebhook);
router.get( '/status/:id',     requireRole(...ALL_ROLES), ctrl.getTransactionStatus);
router.get( '/my-transactions', requireRole(...ALL_ROLES), ctrl.getUserTransactions);

module.exports = router;
