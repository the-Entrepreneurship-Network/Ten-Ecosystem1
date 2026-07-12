'use strict';

/**
 * @fileoverview Role-based access control middleware factory.
 * Does NOT modify or replace existing student/HR/coordinator middleware.
 */

const { ROLES } = require('../config/roles');

/**
 * Factory that returns an Express middleware enforcing role-based access.
 * Usage: router.get('/path', requireRole(ROLES.FOUNDER, ROLES.ADMIN), handler)
 *
 * @param {...string} roles - One or more roles that are permitted.
 * @returns {import('express').RequestHandler}
 */
function requireRole(...roles) {
  if (roles.length === 0) {
    throw new Error('requireRole() requires at least one role argument');
  }

  return function roleGuardMiddleware(req, res, next) {
    const user = req.user;

    if (!user) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required.',
      });
    }

    if (!roles.includes(user.role)) {
      return res.status(403).json({
        success: false,
        error: `Access denied. Required role: ${roles.join(' or ')}.`,
        yourRole: user.role,
      });
    }

    return next();
  };
}

/**
 * Middleware that attaches the authenticated ecosystem user to req.user.
 * Reads the 'x-ecosystem-user-id' header set by upstream auth middleware
 * or falls back to a simple session check.
 *
 * NOTE: For Phase 2 replace with proper JWT verification.
 */
function attachEcosystemUser(req, res, next) {
  const userId = req.headers['x-ecosystem-user-id'] || (req.session && req.session.ecosystemUserId);
  if (userId) {
    req.user = req.user || { _id: userId, role: req.headers['x-ecosystem-user-role'] || ROLES.FOUNDER };
  }
  return next();
}

module.exports = { requireRole, attachEcosystemUser };
