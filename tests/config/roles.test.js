'use strict';

const { ROLES, LEGACY_ROLES, ECOSYSTEM_ROLES, ALL_ROLES } = require('../../config/roles');

describe('config/roles', () => {
  describe('ROLES', () => {
    it('contains all expected role keys', () => {
      expect(ROLES.STUDENT).toBe('student');
      expect(ROLES.HR).toBe('hr');
      expect(ROLES.COORDINATOR).toBe('coordinator');
      expect(ROLES.ADMIN).toBe('admin');
      expect(ROLES.FOUNDER).toBe('founder');
      expect(ROLES.MENTOR).toBe('mentor');
      expect(ROLES.INVESTOR).toBe('investor');
      expect(ROLES.CONTRACTOR).toBe('contractor');
    });

    it('is frozen (immutable)', () => {
      expect(Object.isFrozen(ROLES)).toBe(true);
    });

    it('has exactly 8 roles', () => {
      expect(Object.keys(ROLES)).toHaveLength(8);
    });
  });

  describe('LEGACY_ROLES', () => {
    it('contains student, hr, coordinator, admin', () => {
      expect(LEGACY_ROLES).toEqual(['student', 'hr', 'coordinator', 'admin']);
    });

    it('is frozen', () => {
      expect(Object.isFrozen(LEGACY_ROLES)).toBe(true);
    });
  });

  describe('ECOSYSTEM_ROLES', () => {
    it('contains founder, mentor, investor, contractor', () => {
      expect(ECOSYSTEM_ROLES).toEqual(['founder', 'mentor', 'investor', 'contractor']);
    });

    it('is frozen', () => {
      expect(Object.isFrozen(ECOSYSTEM_ROLES)).toBe(true);
    });
  });

  describe('ALL_ROLES', () => {
    it('is the union of LEGACY_ROLES and ECOSYSTEM_ROLES', () => {
      expect(ALL_ROLES).toEqual([...LEGACY_ROLES, ...ECOSYSTEM_ROLES]);
    });

    it('has 8 entries total', () => {
      expect(ALL_ROLES).toHaveLength(8);
    });

    it('is frozen', () => {
      expect(Object.isFrozen(ALL_ROLES)).toBe(true);
    });

    it('has no duplicates', () => {
      const unique = new Set(ALL_ROLES);
      expect(unique.size).toBe(ALL_ROLES.length);
    });
  });
});
