'use strict';

const express = require('express');
const { getPendingProfiles, getVerificationStats } = require('../controllers/verificationController');
const { requireRole } = require('../middleware/roleGuard');
const { ROLES }       = require('../config/roles');

const router = express.Router();

router.get('/pending', requireRole(ROLES.ADMIN, ROLES.HR, ROLES.COORDINATOR), getPendingProfiles);
router.get('/stats',   requireRole(ROLES.ADMIN, ROLES.HR),                    getVerificationStats);

module.exports = router;
