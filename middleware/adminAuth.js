/**
 * Admin portal authentication and role-based access control.
 *
 * Login checks AdminUser (founder/admin) OR HR (hr_1–hr_8) by
 * username+password using bcrypt.compare against the stored hash.
 * No hardcoded passwords, no bypass logic, no fallbacks of any kind.
 */

const bcrypt = require('bcryptjs');
const AdminUser = require('../models/AdminUser');
const HR = require('../models/HR');

const SESSION_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

// Numeric level for every role — hr_1=1 … hr_8=8, admin=9, founder=10
const ROLE_LEVEL = {
  hr_1: 1, hr_2: 2, hr_3: 3, hr_4: 4,
  hr_5: 5, hr_6: 6, hr_7: 7, hr_8: 8,
  admin: 9, founder: 10
};

const VALID_HR_ROLES = new Set(['hr_1','hr_2','hr_3','hr_4','hr_5','hr_6','hr_7','hr_8']);

/**
 * Verify credentials against AdminUser or HR collections.
 * Returns session-ready object on success, null on failure.
 * Never logs passwords. Never uses fallback access.
 */
async function verifyAdminCredentials(username, password) {
  if (!username || !password) return null;

  const uname = username.trim();

  // ── 1. Check AdminUser (founder / admin) ──────────────────────────────────
  try {
    const adminUser = await AdminUser.findOne({ username: uname, isActive: true });
    if (adminUser) {
      const match = await bcrypt.compare(password, adminUser.passwordHash);
      if (!match) return null;
      adminUser.lastLogin = new Date();
      await adminUser.save();
      return {
        userId:   adminUser._id.toString(),
        username: adminUser.username,
        role:     adminUser.role,
        level:    ROLE_LEVEL[adminUser.role]
      };
    }
  } catch (err) {
    console.error('[AdminAuth] AdminUser lookup error:', err.message);
    return null;
  }

  // ── 2. Check HR (hr_1 through hr_8) ───────────────────────────────────────
  try {
    const hr = await HR.findOne({
      $or: [{ username: uname }, { email: uname.toLowerCase() }]
    });
    if (hr) {
      const match = await bcrypt.compare(password, hr.password);
      if (!match) return null;
      const role = VALID_HR_ROLES.has(hr.role) ? hr.role : 'hr_1';
      return {
        userId:   hr._id.toString(),
        username: hr.username || hr.email,
        role,
        level:    ROLE_LEVEL[role]
      };
    }
  } catch (err) {
    console.error('[AdminAuth] HR lookup error:', err.message);
    return null;
  }

  return null;
}

/**
 * Page-level guard — redirects to login on failure (for HTML routes).
 */
function requireAdmin(req, res, next) {
  const admin = req.session.adminUser;
  if (!admin) return res.redirect('/ten-admin/login');
  if (Date.now() - admin.lastActivity > SESSION_TIMEOUT_MS) {
    req.session.adminUser = null;
    return res.redirect('/ten-admin/login?timeout=1');
  }
  req.session.adminUser.lastActivity = Date.now();
  next();
}

/**
 * API-level guard — returns JSON 401/403 on failure.
 * minLevel: numeric 1–10 matching ROLE_LEVEL values.
 */
function requireRole(minLevel) {
  return function (req, res, next) {
    const admin = req.session.adminUser;
    if (!admin) {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    if (Date.now() - admin.lastActivity > SESSION_TIMEOUT_MS) {
      req.session.adminUser = null;
      return res.status(401).json({ error: 'Session expired' });
    }
    if ((admin.level || 0) < minLevel) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    req.session.adminUser.lastActivity = Date.now();
    next();
  };
}

module.exports = { requireAdmin, requireRole, verifyAdminCredentials, ROLE_LEVEL };
