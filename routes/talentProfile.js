'use strict';

const express                      = require('express');
const ctrl                         = require('../controllers/talentProfileController');
const { validateTalentProfile }    = require('../middleware/validateTalentProfile');
const { requireRole }              = require('../middleware/roleGuard');
const { ROLES }                    = require('../config/roles');

const router = express.Router();

const ALL_AUTH = [ROLES.STUDENT, ROLES.HR, ROLES.COORDINATOR, ROLES.ADMIN, ROLES.FOUNDER, ROLES.MENTOR, ROLES.INVESTOR, ROLES.CONTRACTOR];
const VERIFIERS = [ROLES.ADMIN, ROLES.HR, ROLES.COORDINATOR];

router.post(  '/profile',               requireRole(...ALL_AUTH), validateTalentProfile, ctrl.createOrUpdate);
router.get(   '/profile/me',            requireRole(...ALL_AUTH), ctrl.getMyProfile);
router.get(   '/search',                requireRole(...ALL_AUTH), ctrl.searchTalents);
router.get(   '/profile/:userId',       ctrl.getPublicProfile);
router.patch( '/profile/:userId/verify', requireRole(...VERIFIERS), ctrl.verifyProfile);

module.exports = router;
