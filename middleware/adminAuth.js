const bcrypt = require('bcryptjs');

// ─────────────────────────────────────────────────────────────────────────────
// Admin portal authentication.
//
// Credentials come from the environment only:
//   ADMIN_USERNAME       — the single admin login name (default 'tenadmin')
//   ADMIN_PASSWORD_HASH  — a bcrypt hash. Generate with:
//       node -e "console.log(require('bcryptjs').hashSync(process.argv[1],12))" 'your-password'
//
// There is deliberately no cleartext password support, no default password and
// no fallback list. If ADMIN_PASSWORD_HASH is unset the portal is closed: in
// production the process refuses to boot (see config/secrets.js), and outside
// production every login attempt is rejected.
// ─────────────────────────────────────────────────────────────────────────────

const ADMIN_USERNAME = (process.env.ADMIN_USERNAME || 'tenadmin').trim().toLowerCase();
const ADMIN_PASSWORD_HASH = (process.env.ADMIN_PASSWORD_HASH || '').trim();
const SESSION_TIMEOUT_MS = 30 * 60 * 1000;

const BCRYPT_PREFIXES = ['$2a$', '$2b$', '$2y$'];

function looksLikeBcryptHash(value) {
  return BCRYPT_PREFIXES.some((p) => value.startsWith(p));
}

// Say once, at boot, whether admin login can possibly work.
//
// The login endpoint answers every failure with the same "Access denied"
// — correct, because it must not tell an attacker which factor was wrong, but
// it also left the operator with no way to tell a wrong password from a hash
// that was never loaded. This line appears in `pm2 logs` immediately and names
// the problem. It never prints the hash.
(function reportAdminAuthConfig() {
  const label = '[AdminAuth]';
  if (!ADMIN_PASSWORD_HASH) {
    console.warn(`${label} ADMIN_PASSWORD_HASH is not set — admin login is DISABLED. Run: node scripts/check-admin-login.js`);
    return;
  }
  if (!looksLikeBcryptHash(ADMIN_PASSWORD_HASH)) {
    console.warn(`${label} ADMIN_PASSWORD_HASH is not a bcrypt hash (expected $2a$/$2b$/$2y$) — admin login is DISABLED. Run: node scripts/check-admin-login.js`);
    return;
  }
  if (ADMIN_PASSWORD_HASH.length !== 60) {
    console.warn(`${label} ADMIN_PASSWORD_HASH is ${ADMIN_PASSWORD_HASH.length} chars, expected 60 — it is truncated or was mangled by the shell. Run: node scripts/check-admin-login.js`);
    return;
  }
  console.log(`${label} Admin login enabled for username "${ADMIN_USERNAME}".`);
})();

/**
 * Verify admin credentials against ADMIN_USERNAME + ADMIN_PASSWORD_HASH.
 * Returns true only on an exact username match and a successful bcrypt compare.
 *
 * Never logs the submitted password, and never reveals which of the two
 * factors failed.
 */
async function verifyAdminCredentials(username, password) {
  if (typeof username !== 'string' || typeof password !== 'string') return false;
  if (!username || !password) return false;

  if (!ADMIN_PASSWORD_HASH) {
    console.error('[AdminAuth] ADMIN_PASSWORD_HASH is not configured; admin login is disabled.');
    return false;
  }
  if (!looksLikeBcryptHash(ADMIN_PASSWORD_HASH)) {
    console.error('[AdminAuth] ADMIN_PASSWORD_HASH is not a bcrypt hash; admin login is disabled.');
    return false;
  }

  if (username.trim().toLowerCase() !== ADMIN_USERNAME) {
    // Still run a compare so a wrong username and a wrong password take a
    // similar amount of time.
    try { await bcrypt.compare(password, ADMIN_PASSWORD_HASH); } catch (_) {}
    return false;
  }

  try {
    return await bcrypt.compare(password, ADMIN_PASSWORD_HASH);
  } catch (err) {
    console.error('[AdminAuth] bcrypt comparison failed:', err.message);
    return false;
  }
}

function isSessionFresh(admin) {
  return !!admin && (Date.now() - admin.lastActivity) <= SESSION_TIMEOUT_MS;
}

function requireAdmin(req, res, next) {
  const admin = req.session && req.session.adminUser;
  if (!admin) {
    return res.redirect('/ten-admin/login');
  }
  if (!isSessionFresh(admin)) {
    req.session.adminUser = null;
    return res.redirect('/ten-admin/login?timeout=1');
  }
  req.session.adminUser.lastActivity = Date.now();
  next();
}

function requireAdminAPI(req, res, next) {
  const admin = req.session && req.session.adminUser;
  if (!admin) {
    res.set('X-Session-Expired', '1');
    return res.status(401).json({ error: 'Not authenticated' });
  }
  if (!isSessionFresh(admin)) {
    req.session.adminUser = null;
    res.set('X-Session-Expired', '1');
    return res.status(401).json({ error: 'Session expired' });
  }
  req.session.adminUser.lastActivity = Date.now();
  next();
}

module.exports = { requireAdmin, requireAdminAPI, ADMIN_USERNAME, verifyAdminCredentials };
