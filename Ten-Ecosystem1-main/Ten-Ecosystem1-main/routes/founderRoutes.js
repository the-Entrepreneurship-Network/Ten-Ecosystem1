'use strict';

const express                  = require('express');
const { getDashboard }         = require('../controllers/founderController');
const { requireRole }          = require('../middleware/roleGuard');
const { ROLES }                = require('../config/roles');

const router = express.Router();

router.get('/dashboard', requireRole(ROLES.FOUNDER), getDashboard);

module.exports = router;
