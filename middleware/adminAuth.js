'use strict';

/**
 * @fileoverview Admin portal authentication.
 *
 * ── SECURITY REWRITE ────────────────────────────────────────────────────────
 * The previous implementation contained a total authentication bypass. It:
 *
 *   1. Treated ANY username containing 'admin', 'growth', 'nagbishal' or
 *      'vishal' as an administrator.
 *   2. Ended with an "ULTRA-RESILIENT FALLBACK" that returned `true`
 *      unconditionally after every password check had failed — so any
 *      password logged in.
 *   3. Accepted a hardcoded list of guessable passwords ('admin', 'admin123',
 *      'password', 'ten@admin', ...) case-insensitively.
 *   4. Accepted any password merely *containing* 'ten@admin' / 'admin2024'.
 *   5. Defaulted to the hardcoded password 'TEN@Admin2024' when
 *      ADMIN_PORTAL_PASSWORD was unset.
 *   6. Appended every submitted password in cleartext — plus a hex dump — to
 *      login_attempts.log, and echoed password lengths to stdout.
 *   7. Exported ADMIN_PASSWORD from the module.
 *
 * This version:
 *   - Verifies a single bcrypt hash (ADMIN_PASSWORD_HASH). No cleartext, no
 *     fallbacks, no fuzzy matching.
 *   - Fails closed: with no hash configured, nobody can log in.
 *   - Compares the username in constant time and always runs the bcrypt
 *     compare, so timing does not reveal whether a username exists.
 *   - Logs no credentials, no lengths, no hex.
 *   - Adds per-IP rate limiting and per-account lockout, because a real
 *     password check invites brute force.
 * ────────────────────────────────────────────────────────────────────────────
 */

const bcrypt    = require('bcryptjs');
const crypto    = require('crypto');
const rateLimit = require('express-rate-limit');
const secrets   = require('../config/secrets');

const SESSION_TIMEOUT_MS = 30 * 60 * 1000;
const ADMIN_USERNAME     = secrets.ADMIN_USERNAME;

// ── Brute-force protection ──────────────────────────────────────────────────
const LOCKOUT_THRESHOLD = 5;
const LOCKOUT_MS        = 15 * 60 * 1000;

/** @type {Map<string, { count: number, until: number }>} */
const failures = new Map();

// Bound the map so a caller cannot grow it without limit by varying its IP.
const MAX_TRACKED = 10000;

function failureKey(req) {
  return String((req && req.ip) || 'unknown');
}

function isLockedOut(key) {
  const entry = failures.get(key);
  if (!entry) return false;
  if (entry.until && entry.until > Date.now()) return true;
  if (entry.until && entry.until <= Date.now()) {
    failures.delete(key); // lockout expired
  }
  return false;
}

function recordFailure(key) {
  if (failures.size > MAX_TRACKED) failures.clear();
  const entry = failures.get(key) || { count: 0, until: 0 };
  entry.count += 1;
  if (entry.count >= LOCKOUT_THRESHOLD) {
    entry.until = Date.now() + LOCKOUT_MS;
    entry.count = 0;
    console.warn('[AdminAuth] Lockout triggered for admin login source.');
  }
  failures.set(key, entry);
}

function clearFailures(key) {
  failures.delete(key);
}

/**
 * Per-IP rate limiter for the admin login route. Mount it on POST /login:
 *   router.post('/login', adminLoginLimiter, handler)
 * @type {import('express').RequestHandler}
 */
const adminLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many login attempts. Try again later.' },
});

/**
 * Middleware that rejects requests from a locked-out source before the
 * password is even checked. Mount after adminLoginLimiter.
 * @type {import('express').RequestHandler}
 */
function adminLockoutGuard(req, res, next) {
  if (isLockedOut(failureKey(req))) {
    return res.status(429).json({
      success: false,
      message: 'Too many failed attempts. Try again later.',
    });
  }
  return next();
}

/**
 * Constant-time string comparison that does not leak length via early exit.
 * Hashing both sides first gives fixed-length buffers, so timingSafeEqual
 * never throws on a length mismatch.
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a), 'utf8').digest();
  const hb = crypto.createHash('sha256').update(String(b), 'utf8').digest();
  return crypto.timingSafeEqual(ha, hb);
}

/**
 * Verify admin credentials against the configured bcrypt hash.
 *
 * Pass `req` to enable lockout accounting (recommended).
 *
 * @param {string} username
 * @param {string} password
 * @param {import('express').Request} [req] Used only for lockout keying.
 * @returns {Promise<boolean>}
 */
async function verifyAdminCredentials(username, password, req) {
  const key = failureKey(req);

  if (typeof username !== 'string' || typeof password !== 'string' || !username || !password) {
    console.warn('[AdminAuth] Rejected login: missing or malformed credentials.');
    recordFailure(key);
    return false;
  }

  if (isLockedOut(key)) {
    console.warn('[AdminAuth] Rejected login: source is locked out.');
    return false;
  }

  const hash = secrets.ADMIN_PASSWORD_HASH;
  if (!hash) {
    // Fail closed. Never fall back to a cleartext or default password.
    console.error(
      '[AdminAuth] ADMIN_PASSWORD_HASH is not configured; denying all admin logins. ' +
      'Generate one with: node -e "console.log(require(\'bcryptjs\').hashSync(process.argv[1],12))" \'your-password\''
    );
    return false;
  }

  // Evaluate both factors unconditionally so response timing is uniform
  // whether the username, the password, or both were wrong.
  const usernameOk = safeEqual(username.trim().toLowerCase(), ADMIN_USERNAME.toLowerCase());

  let passwordOk = false;
  try {
    passwordOk = await bcrypt.compare(password, hash);
  } catch (err) {
    console.error('[AdminAuth] bcrypt comparison error:', err.message);
    return false;
  }

  if (!usernameOk || !passwordOk) {
    // Log the failure WITHOUT the submitted username or password.
    console.warn('[AdminAuth] Failed admin login attempt.');
    recordFailure(key);
    return false;
  }

  clearFailures(key);
  console.log('[AdminAuth] Admin login succeeded.');
  return true;
}

/**
 * Guard for HTML admin routes; redirects to the login page.
 * @type {import('express').RequestHandler}
 */
function requireAdmin(req, res, next) {
  const admin = req.session && req.session.adminUser;
  if (!admin) {
    return res.redirect('/ten-admin/login');
  }
  if (Date.now() - admin.lastActivity > SESSION_TIMEOUT_MS) {
    req.session.adminUser = null;
    return res.redirect('/ten-admin/login?timeout=1');
  }
  req.session.adminUser.lastActivity = Date.now();
  return next();
}

/**
 * Guard for admin JSON APIs; returns 401.
 * @type {import('express').RequestHandler}
 */
function requireAdminAPI(req, res, next) {
  const admin = req.session && req.session.adminUser;
  if (!admin) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  if (Date.now() - admin.lastActivity > SESSION_TIMEOUT_MS) {
    req.session.adminUser = null;
    return res.status(401).json({ error: 'Session expired' });
  }
  req.session.adminUser.lastActivity = Date.now();
  return next();
}

/**
 * Guard for server-to-server admin APIs authenticated by a shared secret.
 * Constant-time comparison, no hardcoded 'TEN_ADMIN_SECRET' fallback.
 * @type {import('express').RequestHandler}
 */
function requireAdminSecret(req, res, next) {
  const provided = req.headers['x-admin-secret'];
  const expected = secrets.ADMIN_API_SECRET;

  if (!expected || typeof provided !== 'string' || !safeEqual(provided, expected)) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  return next();
}

module.exports = {
  requireAdmin,
  requireAdminAPI,
  requireAdminSecret,
  adminLoginLimiter,
  adminLockoutGuard,
  verifyAdminCredentials,
  ADMIN_USERNAME,
  // NOTE: ADMIN_PASSWORD is deliberately NOT exported any more.
};