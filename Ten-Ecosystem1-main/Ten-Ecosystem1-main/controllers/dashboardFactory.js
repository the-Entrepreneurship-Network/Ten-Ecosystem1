'use strict';

/**
 * Factory that produces a stub-dashboard controller for any ecosystem role.
 * Eliminates the four identical founderController / investorController /
 * mentorController / contractorController files.
 *
 * @param {string} role    - ROLES constant (e.g. 'founder')
 * @param {string} message - Placeholder message shown on the dashboard
 * @returns {{ getDashboard: import('express').RequestHandler }}
 */
function createDashboardController(role, message) {
  function getDashboard(req, res) {
    return res.status(200).json({
      success: true,
      role,
      message,
      user: req.user,
    });
  }

  return { getDashboard };
}

module.exports = { createDashboardController };
