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
 *
 * SECURITY: this previously read the identity AND the role from the
 * client-controlled 'x-ecosystem-user-id' / 'x-ecosystem-user-role' request
 * headers. Any caller could send `x-ecosystem-user-role: admin` (plus any
 * user id) and satisfy every requireRole() check -- full authentication
 * bypass and privilege escalation with a single header.
 *
 * Identity and role now come only from the server-side session, which the
 * client cannot forge.
 */
function attachEcosystemUser(req, res, next) {
  const session = req.session;
  if (session && session.ecosystemUserId) {
    // Preserve any req.user already set by upstream auth middleware.
    req.user = req.user || {
      _id: session.ecosystemUserId,
      role: session.ecosystemUserRole || ROLES.FOUNDER,
    };
  }
  return next();
}

module.exports = { requireRole, attachEcosystemUser };