const ADMIN_USERNAME = 'tenadmin';
const ADMIN_PASSWORD = process.env.ADMIN_PORTAL_PASSWORD || 'TEN@Admin2024';
const SESSION_TIMEOUT_MS = 30 * 60 * 1000;

function requireAdmin(req, res, next) {
  const admin = req.session.adminUser;
  if (!admin) {
    return res.redirect('/ten-admin/login');
  }
  if (Date.now() - admin.lastActivity > SESSION_TIMEOUT_MS) {
    req.session.adminUser = null;
    return res.redirect('/ten-admin/login?timeout=1');
  }
  req.session.adminUser.lastActivity = Date.now();
  next();
}

function requireAdminAPI(req, res, next) {
  const admin = req.session.adminUser;
  if (!admin) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  if (Date.now() - admin.lastActivity > SESSION_TIMEOUT_MS) {
    req.session.adminUser = null;
    return res.status(401).json({ error: 'Session expired' });
  }
  req.session.adminUser.lastActivity = Date.now();
  next();
}

module.exports = { requireAdmin, requireAdminAPI, ADMIN_USERNAME, ADMIN_PASSWORD };
