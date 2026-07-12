'use strict';

const express = require('express');
const { getHub, getRoleConfig, registerUser } = require('../controllers/registerHubController');

const router = express.Router();

router.get( '/',         getHub);
router.get( '/roles',    getRoleConfig);
router.post('/register', registerUser);

module.exports = router;
