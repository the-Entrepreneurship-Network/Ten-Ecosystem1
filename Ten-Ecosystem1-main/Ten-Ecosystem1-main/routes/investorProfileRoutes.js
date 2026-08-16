'use strict';

const express = require('express');
const {
  createOrUpdateProfile,
  getMyProfile,
  getInvestorDirectory,
  getInvestorProfile,
  updateVerificationStatus
} = require('../controllers/investorProfileController');
const { requireRole } = require('../middleware/roleGuard');
const { ROLES }       = require('../config/roles');

const router = express.Router();

router.post('/profile',                 requireRole(ROLES.INVESTOR, ROLES.ADMIN),                     createOrUpdateProfile);
router.get('/profile/me',               requireRole(ROLES.INVESTOR, ROLES.ADMIN),                     getMyProfile);
router.get('/directory',                requireRole(...Object.values(ROLES)),                           getInvestorDirectory);
router.get('/profile/:userId',          requireRole(...Object.values(ROLES)),                           getInvestorProfile);
router.patch('/profile/:userId/verify', requireRole(ROLES.ADMIN, ROLES.HR, ROLES.COORDINATOR),         updateVerificationStatus);

module.exports = router;
