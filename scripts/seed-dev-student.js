#!/usr/bin/env node
'use strict';

/**
 * Seed one student into the local JSON fallback database, for development and
 * for scripts/verify-security.sh.
 *
 * Refuses to run against a real database or in production — this writes a
 * known password and must never touch live data.
 *
 *   node scripts/seed-dev-student.js
 */

const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');

if (process.env.NODE_ENV === 'production') {
  console.error('Refusing to seed a development account in production.');
  process.exit(1);
}
if (process.env.MONGODB_URI) {
  console.error('MONGODB_URI is set. This script only writes the local JSON fallback DB.');
  console.error('Unset MONGODB_URI to seed local development data.');
  process.exit(1);
}

const DB_DIR = process.env.LOCAL_DB_DIR
  ? path.resolve(process.env.LOCAL_DB_DIR)
  : path.join(__dirname, '..', '.data', 'local_db');

const EMPLOYEE_ID = 'TEN/WEB/1001';
const PASSWORD = 'TestPass!2026';

fs.mkdirSync(DB_DIR, { recursive: true });

const now = new Date().toISOString();
const student = {
  _id: 'aaaaaaaaaaaaaaaaaaaaaaa1',
  firstName: 'Test',
  lastName: 'Student',
  name: 'Test Student',
  email: 'teststudent@example.com',
  whatsapp: '9000000000',
  employeeId: EMPLOYEE_ID,
  domain: 'Web Development',
  domains: ['Web Development'],
  tenure: '45 Days',
  joiningDate: '2026-07-01',
  collegeName: 'Test College',
  college: 'Test College',
  gender: '',
  password: bcrypt.hashSync(PASSWORD, 10),
  joinerType: 'new',
  internshipStartDate: null,
  v2Onboarded: false,
  v2DurationType: null,
  starStatus: 'not_submitted',
  locStatus: 'not_eligible',
  lorStatus: 'not_eligible',
  offerLetterStatus: 'not_uploaded',
  internshipCompleted: false,
  failedLoginAttempts: 0,
  isLockedOut: false,
  lockoutUntil: null,
  createdAt: now,
  updatedAt: now
};

const target = path.join(DB_DIR, 'db_Student.json');
let existing = [];
if (fs.existsSync(target)) {
  try { existing = JSON.parse(fs.readFileSync(target, 'utf8')) || []; } catch (_) { existing = []; }
}
const rest = existing.filter((s) => s && s.employeeId !== EMPLOYEE_ID);
fs.writeFileSync(target, JSON.stringify([student, ...rest], null, 2));

console.log(`Seeded ${EMPLOYEE_ID} into ${target}`);
console.log(`Password: ${PASSWORD}`);
