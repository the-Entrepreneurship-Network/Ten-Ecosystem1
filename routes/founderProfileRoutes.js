'use strict';

const express = require('express');
const {
  createOrUpdateProfile,
  getMyProfile,
  getFounderDirectory,
  getFounderProfile,
  updateVerificationStatus
} = require('../controllers/founderProfileController');
const { requireRole } = require('../middleware/roleGuard');
const { ROLES }       = require('../config/roles');

const router = express.Router();

router.post('/profile',                     requireRole(ROLES.FOUNDER, ROLES.ADMIN),                       createOrUpdateProfile);
router.get('/profile/me',                   requireRole(ROLES.FOUNDER, ROLES.ADMIN),                       getMyProfile);
router.get('/directory',                    requireRole(...Object.values(ROLES)),                           getFounderDirectory);
router.get('/profile/:userId',              requireRole(...Object.values(ROLES)),                           getFounderProfile);
router.patch('/profile/:userId/verify',     requireRole(ROLES.ADMIN, ROLES.HR, ROLES.COORDINATOR),         updateVerificationStatus);

module.exports = router;
