'use strict';

const express      = require('express');
const ctrl         = require('../controllers/paymentSetuController');
const { requireRole } = require('../middleware/roleGuard');
const { ALL_ROLES }   = require('../config/roles');

const router = express.Router();

router.post('/initiate',       requireRole(...ALL_ROLES), ctrl.initiatePayment);
router.post('/verify',         requireRole(...ALL_ROLES), ctrl.verifyPayment);
router.post('/webhook',        express.raw({ type: 'application/json' }), ctrl.handleWebhook);
router.get( '/status/:id',     requireRole(...ALL_ROLES), ctrl.getTransactionStatus);
router.get( '/my-transactions', requireRole(...ALL_ROLES), ctrl.getUserTransactions);

module.exports = router;
