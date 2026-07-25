'use strict';

const { requireRole, attachEcosystemUser } = require('../../middleware/roleGuard');
const { ROLES } = require('../../config/roles');
const { mockRes } = require('../helpers');

describe('middleware/roleGuard', () => {
  describe('requireRole', () => {
    it('throws when called with zero arguments', () => {
      expect(() => requireRole()).toThrow('at least one role');
    });

    it('returns a function (middleware)', () => {
      expect(typeof requireRole(ROLES.ADMIN)).toBe('function');
    });

    it('responds 401 when req.user is missing', () => {
      const res = mockRes();
      const next = jest.fn();
      requireRole(ROLES.ADMIN)({}, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ success: false, error: 'Authentication required.' })
      );
      expect(next).not.toHaveBeenCalled();
    });

    it('responds 403 when user role is not in the allowed list', () => {
      const res = mockRes();
      const next = jest.fn();
      requireRole(ROLES.ADMIN, ROLES.HR)({ user: { role: ROLES.STUDENT } }, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ success: false, yourRole: ROLES.STUDENT })
      );
      expect(next).not.toHaveBeenCalled();
    });

    it.each([
      [ROLES.FOUNDER, [ROLES.ADMIN, ROLES.FOUNDER]],
      [ROLES.COORDINATOR, [ROLES.COORDINATOR]],
    ])('calls next() when user.role=%s matches allowed roles', (role, allowed) => {
      const res = mockRes();
      const next = jest.fn();
      requireRole(...allowed)({ user: { role } }, res, next);

      expect(next).toHaveBeenCalledTimes(1);
      expect(res.status).not.toHaveBeenCalled();
    });
  });

  describe('attachEcosystemUser', () => {
    it('attaches user from x-ecosystem-user-id header', () => {
      const req = { headers: { 'x-ecosystem-user-id': 'user123', 'x-ecosystem-user-role': 'mentor' } };
      const next = jest.fn();
      attachEcosystemUser(req, mockRes(), next);

      expect(req.user).toEqual(expect.objectContaining({ _id: 'user123', role: 'mentor' }));
      expect(next).toHaveBeenCalled();
    });

    it('defaults role to FOUNDER when x-ecosystem-user-role header is absent', () => {
      const req = { headers: { 'x-ecosystem-user-id': 'user456' } };
      attachEcosystemUser(req, mockRes(), jest.fn());
      expect(req.user.role).toBe(ROLES.FOUNDER);
    });

    it('falls back to session ecosystemUserId', () => {
      const req = { headers: {}, session: { ecosystemUserId: 'sess-user' } };
      const next = jest.fn();
      attachEcosystemUser(req, mockRes(), next);

      expect(req.user._id).toBe('sess-user');
      expect(next).toHaveBeenCalled();
    });

    it('does not overwrite an existing req.user', () => {
      const existingUser = { _id: 'existing', role: 'admin' };
      const req = { headers: { 'x-ecosystem-user-id': 'new-id' }, user: existingUser };
      attachEcosystemUser(req, mockRes(), jest.fn());
      expect(req.user).toBe(existingUser);
    });

    it('calls next without setting user when no id is available', () => {
      const req = { headers: {} };
      const next = jest.fn();
      attachEcosystemUser(req, mockRes(), next);

      expect(req.user).toBeUndefined();
      expect(next).toHaveBeenCalled();
    });
  });
});
