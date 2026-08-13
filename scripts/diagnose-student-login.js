#!/usr/bin/env node
'use strict';

/**
 * Why can this student not sign in?
 *
 * Run it against a student who reports being locked out and it reports the
 * state of every gate their sign-in passes through, in the order login checks
 * them. It reads only — nothing is changed unless you pass --unlock.
 *
 *   node scripts/diagnose-student-login.js TEN/WEB/1005
 *   node scripts/diagnose-student-login.js aisha@example.com
 *   node scripts/diagnose-student-login.js TEN/WEB/1005 --unlock
 *
 * It never prints a password or a hash. The most it says about the password is
 * whether the stored value looks like a bcrypt hash at all — a row holding
 * something else can never authenticate, and that is worth knowing.
 */

require('dotenv').config();
const mongoose = require('mongoose');

const IDENT = process.argv[2];
const UNLOCK = process.argv.includes('--unlock');

const ok   = (m) => console.log('  ✓ ' + m);
const bad  = (m) => console.log('  ✗ ' + m);
const info = (m) => console.log('    ' + m);

async function main() {
  if (!IDENT) {
    console.error('Usage: node scripts/diagnose-student-login.js <employeeId|email> [--unlock]');
    process.exit(1);
  }
  if (!process.env.MONGODB_URI) {
    console.error('MONGODB_URI is not set. Run this on the server, where .env is.');
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGODB_URI);

  const Student = require('../models/Student');
  const EcosystemUser = require('../models/EcosystemUser');
  const loginIdentity = require('../services/loginIdentity');

  console.log(`\nChecking "${IDENT}"\n${'='.repeat(60)}`);

  // ── 1. Can login find the account at all? ──────────────────────────────
  console.log('\n1. Finding the account');

  const byEmail = loginIdentity.looksLikeEmail(IDENT);
  const student = byEmail
    ? await loginIdentity.findStudentByEmail(Student, IDENT)
    : await loginIdentity.findStudentByEmployeeId(Student, IDENT);

  if (!student) {
    bad('No Student record matches that, even allowing for case and separator.');
    // Offer near misses, so a typo in the ID is obvious rather than mysterious.
    const norm = loginIdentity.normalizeEmployeeId(IDENT);
    const head = norm.split('/').slice(0, 2).join('/');
    if (head) {
      const near = await Student.find({ employeeId: new RegExp('^' + head.replace(/[/\\^$*+?.()|[\]{}]/g, '\\$&'), 'i') })
        .select('employeeId name email').limit(8).lean();
      if (near.length) {
        info('Similar IDs that DO exist:');
        near.forEach(s => info('   ' + s.employeeId + '   ' + (s.name || '') + '   ' + (s.email || '')));
      }
    }
    await mongoose.disconnect();
    return;
  }

  ok(`Found: ${student.employeeId}  ${student.name || ''}  ${student.email || ''}`);
  if (!byEmail && student.employeeId !== IDENT) {
    info(`NOTE: stored as "${student.employeeId}", you typed "${IDENT}".`);
    info('Before this fix that exact-match difference alone refused the sign-in.');
  }

  // ── 2. Is the account locked? ──────────────────────────────────────────
  console.log('\n2. Lockout');
  const lockedUntil = student.lockoutUntil ? new Date(student.lockoutUntil) : null;
  const stillLocked = student.isLockedOut && lockedUntil && lockedUntil > new Date();

  if (stillLocked) {
    const mins = Math.ceil((lockedUntil - Date.now()) / 60000);
    bad(`LOCKED for another ${mins} minute(s) (until ${lockedUntil.toISOString()}).`);
  } else if (student.isLockedOut) {
    info('Flagged locked, but the lock has expired — the next sign-in clears it.');
  } else {
    ok('Not locked.');
  }
  info(`failedLoginAttempts: ${student.failedLoginAttempts || 0}` +
       (student.lastFailedLoginAt ? `  (last: ${new Date(student.lastFailedLoginAt).toISOString()})` : '  (no timestamp — an older row)'));

  // ── 3. Is the stored password usable? ──────────────────────────────────
  console.log('\n3. Stored password');
  const pw = student.password || '';
  if (!pw) {
    bad('EMPTY. This account cannot authenticate at all — it needs a password reset.');
  } else if (/^\$2[aby]\$\d{2}\$/.test(pw)) {
    ok('A bcrypt hash, as expected.');
  } else {
    bad('NOT a bcrypt hash. Login compares with bcrypt only, so this can never match.');
    info('The account needs a password reset. (The value itself is not printed.)');
  }

  // ── 4. The single-session token ────────────────────────────────────────
  console.log('\n4. Single-session guard');
  const eco = student.email
    ? await EcosystemUser.findOne({ email: new RegExp('^\\s*' + String(student.email).replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&') + '\\s*$', 'i') })
        .select('activeSessionToken isActive role').lean()
    : null;

  info(`Student.activeSessionToken:      ${student.activeSessionToken ? 'set' : '(none)'}`);
  if (eco) {
    info(`EcosystemUser.activeSessionToken: ${eco.activeSessionToken ? 'set' : '(none)'}`);
    if (eco.isActive === false) bad('EcosystemUser.isActive is false — HR has suspended this account.');
    if (student.activeSessionToken && eco.activeSessionToken &&
        student.activeSessionToken !== eco.activeSessionToken) {
      bad('The two records hold DIFFERENT tokens.');
      info('That mismatch is what returned 401 SESSION_SUPERSEDED on every');
      info('request and bounced the student back to the login page. Login now');
      info('writes the same token to both; signing in once repairs it.');
    }
  } else {
    info('No EcosystemUser record — this student signs in through the legacy path only.');
  }

  // ── 5. Duplicate records ───────────────────────────────────────────────
  console.log('\n5. Other records with the same email');
  if (student.email) {
    const rx = new RegExp('^\\s*' + String(student.email).replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&') + '\\s*$', 'i');
    const all = await Student.find({ email: rx }).select('employeeId domain createdAt').sort({ createdAt: 1 }).lean();
    if (all.length > 1) {
      info(`${all.length} rows share this email (dual-domain is normal, up to 2):`);
      all.forEach(s => info('   ' + s.employeeId + '   ' + (s.domain || '') + '   created ' + new Date(s.createdAt).toISOString().slice(0, 10)));
      if (all.length > 2) bad('More than 2 — likely duplicates, worth cleaning up.');
    } else {
      ok('Just the one.');
    }
  }

  // ── unlock ─────────────────────────────────────────────────────────────
  if (UNLOCK) {
    console.log('\nApplying --unlock');
    await Student.updateOne({ _id: student._id }, {
      $set: { isLockedOut: false, lockoutUntil: null, failedLoginAttempts: 0, lastFailedLoginAt: null }
    });
    ok('Lockout cleared and the attempt counter reset.');
    info('This does NOT change their password. If section 3 flagged the stored');
    info('password, they still need a reset through Forgot Password.');
  } else if (stillLocked) {
    console.log('\nRe-run with --unlock to clear the lock now, or wait for it to expire.');
  }

  console.log('');
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error('Diagnosis failed:', err.message);
  process.exit(1);
});
