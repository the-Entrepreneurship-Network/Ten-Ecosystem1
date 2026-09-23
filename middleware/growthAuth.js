'use strict';

/**
 * The Growth OS sign-in — its own account, not the admin's.
 *
 *   GROWTH_USERNAME       the login name (default 'growth')
 *   GROWTH_PASSWORD_HASH  a bcrypt hash. Generate with:
 *       node -e "console.log(require('bcryptjs').hashSync(process.argv[1],12))" 'your-password'
 *
 * Separate on purpose. Sending campaigns and editing students are different
 * jobs: whoever writes the Monday mail should not also be able to change a
 * payment or revoke a certificate. Reusing the admin account would have made
 * the Growth OS a second door into everything.
 *
 * Exactly as with adminAuth: no cleartext password, no default, no fallback
 * list. With no hash set the dashboard is simply closed.
 */

const bcrypt = require('bcryptjs');

const GROWTH_USERNAME = (process.env.GROWTH_USERNAME || 'growth').trim().toLowerCase();
const GROWTH_PASSWORD_HASH = (process.env.GROWTH_PASSWORD_HASH || '').trim();
const SESSION_TIMEOUT_MS = 30 * 60 * 1000;

const looksLikeBcryptHash = (v) => ['$2a$', '$2b$', '$2y$'].some((p) => v.startsWith(p));

// Say at boot whether this can work at all. The login endpoint answers every
// failure identically — correct, but it leaves no way to tell a wrong password
// from a hash that was never loaded. This line shows up in `pm2 logs`, and
// never prints the hash.
(function report() {
    if (!GROWTH_PASSWORD_HASH) {
        console.warn('[GrowthAuth] GROWTH_PASSWORD_HASH is not set — the Growth OS login is DISABLED.');
        return;
    }
    if (!looksLikeBcryptHash(GROWTH_PASSWORD_HASH) || GROWTH_PASSWORD_HASH.length !== 60) {
        console.warn('[GrowthAuth] GROWTH_PASSWORD_HASH is not a 60-char bcrypt hash — the Growth OS login is DISABLED.');
        return;
    }
    console.log(`[GrowthAuth] Growth OS login enabled for username "${GROWTH_USERNAME}".`);
})();

async function verifyGrowthCredentials(username, password) {
    if (typeof username !== 'string' || typeof password !== 'string') return false;
    if (!username || !password) return false;
    if (!GROWTH_PASSWORD_HASH || !looksLikeBcryptHash(GROWTH_PASSWORD_HASH)) return false;

    if (username.trim().toLowerCase() !== GROWTH_USERNAME) {
        // Compare anyway so a wrong username and a wrong password take a
        // similar amount of time.
        try { await bcrypt.compare(password, GROWTH_PASSWORD_HASH); } catch (_) {}
        return false;
    }
    try {
        return await bcrypt.compare(password, GROWTH_PASSWORD_HASH);
    } catch (err) {
        console.error('[GrowthAuth] bcrypt comparison failed:', err.message);
        return false;
    }
}

const isFresh = (u) => !!u && (Date.now() - u.lastActivity) <= SESSION_TIMEOUT_MS;

function requireGrowth(req, res, next) {
    const user = req.session && req.session.growthUser;
    if (!user) return res.redirect('/growth/login');
    if (!isFresh(user)) {
        req.session.growthUser = null;
        return res.redirect('/growth/login?timeout=1');
    }
    req.session.growthUser.lastActivity = Date.now();
    next();
}

function requireGrowthAPI(req, res, next) {
    const user = req.session && req.session.growthUser;
    if (!user) {
        res.set('X-Session-Expired', '1');
        return res.status(401).json({ error: 'Not authenticated' });
    }
    if (!isFresh(user)) {
        req.session.growthUser = null;
        res.set('X-Session-Expired', '1');
        return res.status(401).json({ error: 'Session expired' });
    }
    req.session.growthUser.lastActivity = Date.now();
    next();
}

module.exports = { requireGrowth, requireGrowthAPI, verifyGrowthCredentials, GROWTH_USERNAME };
