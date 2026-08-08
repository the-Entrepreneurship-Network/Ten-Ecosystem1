'use strict';

/**
 * One-time (re-runnable) migration: ensures every legacy Student, Coordinator,
 * and HR account has a matching EcosystemUser row, keyed by email. Required
 * before attachUserFromSession can work for every existing user.
 *
 * PREREQUISITE: apply patches/EcosystemUser.enum.patch.txt FIRST. As shipped,
 * EcosystemUser.role only allows ["founder","mentor","investor","contractor",
 * "student"] — it has no "coordinator" or "hr" value, so this script cannot
 * create rows for those two roles until the enum is patched. Running this
 * script beforehand will just log a clear validation failure for every
 * coordinator/HR row (see the catch block below) rather than silently
 * dropping them — but nothing will actually be created for those two groups
 * until the schema fix lands.
 *
 * Usage:
 *   node scripts/backfillEcosystemUsers.js
 *
 * Safe to re-run: upserts by email, never overwrites an existing row's
 * password/role.
 */

require('dotenv').config();
const mongoose = require('mongoose');
const crypto = require('crypto');

const Student = require('../models/Student');
const Coordinator = require('../models/Coordinator');
const HR = require('../models/HR');
const EcosystemUser = require('../models/EcosystemUser');

async function backfillFromCollection(Model, roleLabel, nameFieldFn) {
  const docs = await Model.find({ email: { $exists: true, $ne: '' } }).lean();
  let created = 0, skipped = 0, noEmail = 0;

  for (const doc of docs) {
    const email = (doc.email || '').trim().toLowerCase();
    if (!email) { noEmail++; continue; }

    const existing = await EcosystemUser.findOne({ email }).select('_id').lean();
    if (existing) { skipped++; continue; }

    // Placeholder password — these accounts authenticate through the legacy
    // Student/Coordinator/HR login routes, never directly against
    // EcosystemUser, so this hash is never used to log in. It exists only
    // because the schema requires a password field.
    const placeholder = crypto.randomBytes(24).toString('hex');

    try {
      await EcosystemUser.create({
        role: roleLabel,
        fullName: nameFieldFn(doc) || email,
        email,
        password: placeholder,
        isVerified: true,
        isActive: true
      });
      created++;
    } catch (err) {
      // Duplicate-key races are fine (another run/process got there first)
      if (err.code !== 11000) console.error(`[backfill:${roleLabel}] error for ${email}:`, err.message);
      skipped++;
    }
  }

  console.log(`[backfill:${roleLabel}] created=${created} skipped=${skipped} noEmail=${noEmail} (of ${docs.length} total)`);
}

async function run() {
  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/internship');
  console.log('Connected. Starting backfill...');

  await backfillFromCollection(
    Student, 'student',
    (d) => d.name || `${d.firstName || ''} ${d.lastName || ''}`.trim()
  );
  await backfillFromCollection(
    Coordinator, 'coordinator',
    (d) => d.name || d.username
  );
  await backfillFromCollection(
    HR, 'hr',
    (d) => d.name || d.username
  );

  console.log('Backfill complete.');
  await mongoose.disconnect();
}

run().catch((err) => {
  console.error('Backfill failed:', err);
  process.exit(1);
});