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
      res.set('X-Session-Expired', '1');
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
 * Attach the authenticated ecosystem user to req.user, from the session only.
 *
 * SECURITY: this used to read `x-ecosystem-user-id` and `x-ecosystem-user-role`
 * straight off the request, so any caller could declare itself an admin by
 * setting two headers and walk through every requireRole() guard in the app.
 * Identity now comes exclusively from the server-side session, which only a
 * successful login can write.
 *
 * The session may hold an ecosystem user, or one of the legacy portal roles
 * (student / HR / coordinator / admin) — all of them are mapped here so
 * requireRole() works uniformly across both generations of login.
 */
function attachEcosystemUser(req, res, next) {
  const session = req.session;
  if (!session) return next();

  if (session.ecosystemUserId) {
    /*
     * Both, or neither. The role used to default to FOUNDER when it was
     * absent, so any session carrying an id and no role became a founder —
     * a privilege grant handed out by a missing field. The login writes the
     * pair together; a session with only half of it is broken, not a founder.
     */
    if (session.ecosystemUserRole) {
      req.user = { _id: session.ecosystemUserId, role: session.ecosystemUserRole };
      return next();
    }
    console.warn('[auth] session has ecosystemUserId with no role — ignoring it');
  }

  if (session.adminUser) {
    req.user = { _id: session.adminUser.username, role: ROLES.ADMIN };
  } else if (session.hr) {
    req.user = { _id: session.hr.username || session.hr.email, role: ROLES.HR };
  } else if (session.coordinator) {
    req.user = { _id: session.coordinator.username, role: ROLES.COORDINATOR };
  } else if (session.student) {
    req.user = { _id: session.student._id || session.student.employeeId, role: ROLES.STUDENT };
  }

  return next();
}

module.exports = { requireRole, attachEcosystemUser };
