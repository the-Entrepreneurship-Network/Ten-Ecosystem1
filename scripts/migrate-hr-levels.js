/**
 * Migration: set role = 'hr_1' on any HR document that doesn't already
 * have a valid hr_1–hr_8 value.
 *
 * Safe to run multiple times (idempotent).
 * Reports exactly how many records were updated.
 *
 * Usage:
 *   node scripts/migrate-hr-levels.js
 */

require('dotenv').config();
const mongoose = require('mongoose');

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('[migrate-hr-levels] ERROR: MONGODB_URI is not set.');
    process.exit(1);
  }

  await mongoose.connect(uri);
  console.log('[migrate-hr-levels] Connected to MongoDB.');

  const HR = require('../models/HR');

  const validRoles = ['hr_1','hr_2','hr_3','hr_4','hr_5','hr_6','hr_7','hr_8'];

  const result = await HR.updateMany(
    { role: { $nin: validRoles } },
    { $set: { role: 'hr_1' } }
  );

  console.log(`[migrate-hr-levels] Done. Records updated: ${result.modifiedCount} (matched: ${result.matchedCount}).`);
  await mongoose.disconnect();
  process.exit(0);
}

main().catch(err => {
  console.error('[migrate-hr-levels] Fatal error:', err.message);
  process.exit(1);
});
