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
    // Identity must come from the server-side session only. These headers were
    // previously trusted, which let any caller claim any role — including
    // admin — and walk straight through every requireRole() guard.
    it('IGNORES the x-ecosystem-user-id / -role headers', () => {
      const req = { headers: { 'x-ecosystem-user-id': 'user123', 'x-ecosystem-user-role': 'mentor' } };
      const next = jest.fn();
      attachEcosystemUser(req, mockRes(), next);

      expect(req.user).toBeUndefined();
      expect(next).toHaveBeenCalled();
    });

    it('does not let a spoofed header escalate to admin', () => {
      const req = { headers: { 'x-ecosystem-user-id': 'attacker', 'x-ecosystem-user-role': ROLES.ADMIN } };
      attachEcosystemUser(req, mockRes(), jest.fn());
      expect(req.user).toBeUndefined();
    });

    it('a header cannot override the role held in the session', () => {
      const req = {
        headers: { 'x-ecosystem-user-role': ROLES.ADMIN },
        session: { ecosystemUserId: 'sess-user', ecosystemUserRole: ROLES.MENTOR }
      };
      attachEcosystemUser(req, mockRes(), jest.fn());
      expect(req.user).toEqual({ _id: 'sess-user', role: ROLES.MENTOR });
    });

    it('attaches the ecosystem user from the session', () => {
      const req = { headers: {}, session: { ecosystemUserId: 'sess-user' } };
      const next = jest.fn();
      attachEcosystemUser(req, mockRes(), next);

      expect(req.user._id).toBe('sess-user');
      expect(next).toHaveBeenCalled();
    });

    it('defaults an ecosystem session with no stored role to FOUNDER', () => {
      const req = { headers: {}, session: { ecosystemUserId: 'user456' } };
      attachEcosystemUser(req, mockRes(), jest.fn());
      expect(req.user.role).toBe(ROLES.FOUNDER);
    });

    it.each([
      ['adminUser',   { adminUser: { username: 'tenadmin' } },              'tenadmin',      ROLES.ADMIN],
      ['hr',          { hr: { username: 'vp@ten.com' } },                   'vp@ten.com',    ROLES.HR],
      ['coordinator', { coordinator: { username: 'web_admin' } },           'web_admin',     ROLES.COORDINATOR],
      ['student',     { student: { _id: 'stu1', employeeId: 'TEN/WEB/1' } },'stu1',          ROLES.STUDENT]
    ])('maps a legacy %s session onto req.user', (_label, session, expectedId, expectedRole) => {
      const req = { headers: {}, session };
      attachEcosystemUser(req, mockRes(), jest.fn());
      expect(req.user).toEqual({ _id: expectedId, role: expectedRole });
    });

    it('calls next without setting user when there is no session', () => {
      const req = { headers: {} };
      const next = jest.fn();
      attachEcosystemUser(req, mockRes(), next);

      expect(req.user).toBeUndefined();
      expect(next).toHaveBeenCalled();
    });

    it('calls next without setting user for an empty session', () => {
      const req = { headers: {}, session: {} };
      const next = jest.fn();
      attachEcosystemUser(req, mockRes(), next);

      expect(req.user).toBeUndefined();
      expect(next).toHaveBeenCalled();
    });
  });
});
