'use strict';

const express                  = require('express');
const { getDashboard }         = require('../controllers/investorController');
const { requireRole }          = require('../middleware/roleGuard');
const { ROLES }                = require('../config/roles');

const router = express.Router();

router.get('/dashboard', requireRole(ROLES.INVESTOR), getDashboard);

module.exports = router;
