'use strict';

/**
 * @fileoverview Founder dashboard controller.
 */

const { ROLES } = require('../config/roles');

/**
 * GET /api/founder/dashboard
 * Returns founder dashboard stub. Phase 2 will add real metrics.
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 */
function getDashboard(req, res) {
  return res.status(200).json({
    success: true,
    role:    ROLES.FOUNDER,
    message: 'Founder OS coming soon',
    user:    req.user,
  });
}

module.exports = { getDashboard };
