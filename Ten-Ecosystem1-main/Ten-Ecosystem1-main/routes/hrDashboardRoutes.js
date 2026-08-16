'use strict';

const express = require('express');
const { getEcosystemOverview } = require('../controllers/hrDashboardController');
const { requireRole }          = require('../middleware/roleGuard');
const { ROLES }                = require('../config/roles');

const router = express.Router();

router.get('/ecosystem-overview', requireRole(ROLES.ADMIN, ROLES.HR, ROLES.COORDINATOR), getEcosystemOverview);

module.exports = router;
