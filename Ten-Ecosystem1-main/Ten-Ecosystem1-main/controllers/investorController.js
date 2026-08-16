'use strict';

/**
 * @fileoverview Investor dashboard controller.
 */

const { ROLES } = require('../config/roles');

/**
 * GET /api/investor/dashboard
 * Returns investor dashboard stub. Phase 2 will add real metrics.
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 */
function getDashboard(req, res) {
  return res.status(200).json({
    success: true,
    role:    ROLES.INVESTOR,
    message: 'Investor portal coming soon',
    user:    req.user,
  });
}

module.exports = { getDashboard };
