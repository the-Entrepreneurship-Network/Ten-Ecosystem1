'use strict';

const express = require('express');
const {
  createOrUpdateProfile,
  getMyProfile,
  getMentorDirectory,
  getMentorProfile,
  updateVerificationStatus
} = require('../controllers/mentorProfileController');
const { requireRole } = require('../middleware/roleGuard');
const { ROLES }       = require('../config/roles');

const router = express.Router();

router.post('/profile',                 requireRole(ROLES.MENTOR, ROLES.ADMIN),                       createOrUpdateProfile);
router.get('/profile/me',               requireRole(ROLES.MENTOR, ROLES.ADMIN),                       getMyProfile);
router.get('/directory',                requireRole(...Object.values(ROLES)),                           getMentorDirectory);
router.get('/profile/:userId',          requireRole(...Object.values(ROLES)),                           getMentorProfile);
router.patch('/profile/:userId/verify', requireRole(ROLES.ADMIN, ROLES.HR, ROLES.COORDINATOR),         updateVerificationStatus);

module.exports = router;
