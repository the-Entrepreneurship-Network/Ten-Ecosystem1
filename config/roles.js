//E:\Downloads\Ten-Ecosystem1\config\roles.js
'use strict';

/**
 * @fileoverview Centralised role constants for TEN platform.
 * Import ROLES from this file everywhere — never hardcode role strings.
 */

/** @type {Readonly<{[key: string]: string}>} */
const ROLES = Object.freeze({
  STUDENT:     'student',
  HR:          'hr',
  COORDINATOR: 'coordinator',
  ADMIN:       'admin',
  FOUNDER:     'founder',
  MENTOR:      'mentor',
  INVESTOR:    'investor',
  CONTRACTOR:  'contractor',
});

/** All roles that existed before Phase 1 */
const LEGACY_ROLES = Object.freeze([
  ROLES.STUDENT,
  ROLES.HR,
  ROLES.COORDINATOR,
  ROLES.ADMIN,
]);

/** New Phase 1 ecosystem roles */
const ECOSYSTEM_ROLES = Object.freeze([
  ROLES.FOUNDER,
  ROLES.MENTOR,
  ROLES.INVESTOR,
  ROLES.CONTRACTOR,
]);

/** All valid roles */
const ALL_ROLES = Object.freeze([...LEGACY_ROLES, ...ECOSYSTEM_ROLES]);

module.exports = { ROLES, LEGACY_ROLES, ECOSYSTEM_ROLES, ALL_ROLES };
