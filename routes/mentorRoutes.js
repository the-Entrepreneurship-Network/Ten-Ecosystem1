'use strict';

const express                  = require('express');
const { getDashboard }         = require('../controllers/mentorController');
const { requireRole }          = require('../middleware/roleGuard');
const { ROLES }                = require('../config/roles');

const router = express.Router();

router.get('/dashboard', requireRole(ROLES.MENTOR), getDashboard);

module.exports = router;
