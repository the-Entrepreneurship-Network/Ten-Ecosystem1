'use strict';

const bcrypt = require('bcryptjs');

const CORRECT_PASSWORD = 'a-correct-admin-password';
const HASH = bcrypt.hashSync(CORRECT_PASSWORD, 4); // low cost: tests only

/**
 * adminAuth reads its configuration at require() time, so each scenario needs
 * a fresh module registry with the environment already in place.
 */
function loadAuth(env = {}) {
  let mod;
  jest.isolateModules(() => {
    const saved = { ...process.env };
    Object.assign(process.env, env);
    mod = require('../../middleware/adminAuth');
    process.env = saved;
  });
  return mod;
}

const CONFIGURED = { ADMIN_USERNAME: 'tenadmin', ADMIN_PASSWORD_HASH: HASH };

describe('middleware/adminAuth', () => {
  describe('verifyAdminCredentials', () => {
    it('accepts the configured username with the correct password', async () => {
      const { verifyAdminCredentials } = loadAuth(CONFIGURED);
      await expect(verifyAdminCredentials('tenadmin', CORRECT_PASSWORD)).resolves.toBe(true);
    });

    it('is case-insensitive on the username but not the password', async () => {
      const { verifyAdminCredentials } = loadAuth(CONFIGURED);
      await expect(verifyAdminCredentials('TenAdmin', CORRECT_PASSWORD)).resolves.toBe(true);
      await expect(verifyAdminCredentials('tenadmin', CORRECT_PASSWORD.toUpperCase())).resolves.toBe(false);
    });

    it('rejects a wrong password', async () => {
      const { verifyAdminCredentials } = loadAuth(CONFIGURED);
      await expect(verifyAdminCredentials('tenadmin', 'wrong')).resolves.toBe(false);
    });

    // Regression: verifyAdminCredentials used to end in an unconditional
    // `return true` for any username matching a loose substring allow-list, so
    // every one of these logged in with any password at all.
    it.each([
      'admin', 'Admin', 'xadminx', 'superadmin', 'ten-admin', 'growth',
      'growth-eng', 'nagbishal99@gmail.com', 'vishal', 'owner'
    ])('rejects the previously bypassed username %p with a wrong password', async (username) => {
      const { verifyAdminCredentials } = loadAuth(CONFIGURED);
      await expect(verifyAdminCredentials(username, 'literally-anything')).resolves.toBe(false);
    });

    // Regression: an 18-entry hardcoded fallback list and a substring match
    // ("contains ten@admin / admin2024 / ...") both granted access.
    it.each([
      'TEN@Admin2024', 'ten@admin2024', 'tenadmin2026', 'admin', 'admin123',
      'password', 'admin@123', 'admin1234', 'my-ten@admin-pass', 'xxadmin2026xx'
    ])('rejects the previously hardcoded password %p', async (password) => {
      const { verifyAdminCredentials } = loadAuth(CONFIGURED);
      await expect(verifyAdminCredentials('tenadmin', password)).resolves.toBe(false);
    });

    it('rejects everything when ADMIN_PASSWORD_HASH is unset', async () => {
      const { verifyAdminCredentials } = loadAuth({ ADMIN_USERNAME: 'tenadmin', ADMIN_PASSWORD_HASH: '' });
      await expect(verifyAdminCredentials('tenadmin', CORRECT_PASSWORD)).resolves.toBe(false);
      await expect(verifyAdminCredentials('tenadmin', '')).resolves.toBe(false);
    });

    it('refuses a cleartext ADMIN_PASSWORD_HASH rather than comparing it directly', async () => {
      const { verifyAdminCredentials } = loadAuth({
        ADMIN_USERNAME: 'tenadmin',
        ADMIN_PASSWORD_HASH: 'not-a-bcrypt-hash'
      });
      await expect(verifyAdminCredentials('tenadmin', 'not-a-bcrypt-hash')).resolves.toBe(false);
    });

    it.each([
      [undefined, CORRECT_PASSWORD],
      ['tenadmin', undefined],
      ['', ''],
      [null, null],
      [{}, []]
    ])('rejects non-string / empty credentials (%p, %p)', async (username, password) => {
      const { verifyAdminCredentials } = loadAuth(CONFIGURED);
      await expect(verifyAdminCredentials(username, password)).resolves.toBe(false);
    });
  });

  describe('requireAdminAPI', () => {
    const mockRes = () => {
      const res = {};
      res.headers = {};
      res.status = jest.fn(() => res);
      res.json = jest.fn(() => res);
      res.set = jest.fn((k, v) => { res.headers[String(k).toLowerCase()] = v; return res; });
      return res;
    };

    it('401s with no session', () => {
      const { requireAdminAPI } = loadAuth(CONFIGURED);
      const res = mockRes();
      const next = jest.fn();
      requireAdminAPI({ session: {} }, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(next).not.toHaveBeenCalled();
    });

    it('401s and clears an expired session', () => {
      const { requireAdminAPI } = loadAuth(CONFIGURED);
      const res = mockRes();
      const next = jest.fn();
      const session = { adminUser: { username: 'tenadmin', lastActivity: Date.now() - (31 * 60 * 1000) } };
      requireAdminAPI({ session }, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(session.adminUser).toBeNull();
      expect(next).not.toHaveBeenCalled();
    });

    it('passes a fresh session through and slides the expiry', () => {
      const { requireAdminAPI } = loadAuth(CONFIGURED);
      const res = mockRes();
      const next = jest.fn();
      const staleButValid = Date.now() - 1000;
      const session = { adminUser: { username: 'tenadmin', lastActivity: staleButValid } };
      requireAdminAPI({ session }, res, next);

      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
      expect(session.adminUser.lastActivity).toBeGreaterThan(staleButValid);
    });
  });

  it('does not export a password or hash', () => {
    const mod = loadAuth(CONFIGURED);
    expect(mod.ADMIN_PASSWORD).toBeUndefined();
    expect(mod.ADMIN_PASSWORD_HASH).toBeUndefined();
    expect(Object.values(mod)).not.toContain(CORRECT_PASSWORD);
  });
});
