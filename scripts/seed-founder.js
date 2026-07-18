/**
 * One-time seed script: creates the Founder account.
 *
 * Usage:
 *   FOUNDER_USERNAME=<u> FOUNDER_EMAIL=<e> FOUNDER_PASSWORD=<p> node scripts/seed-founder.js
 *
 * - Reads credentials from environment variables only. Nothing is hardcoded.
 * - Refuses to run if a founder account already exists (idempotent).
 * - Never prints the password.
 */

require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

async function main() {
  const username = process.env.FOUNDER_USERNAME;
  const email    = process.env.FOUNDER_EMAIL;
  const password = process.env.FOUNDER_PASSWORD;

  if (!username || !email || !password) {
    console.error('[seed-founder] ERROR: FOUNDER_USERNAME, FOUNDER_EMAIL, and FOUNDER_PASSWORD must all be set.');
    process.exit(1);
  }

  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('[seed-founder] ERROR: MONGODB_URI is not set. This script requires a real MongoDB connection.');
    process.exit(1);
  }

  await mongoose.connect(uri);
  console.log('[seed-founder] Connected to MongoDB.');

  // Require AdminUser model after connection
  const AdminUser = require('../models/AdminUser');

  const existing = await AdminUser.findOne({ role: 'founder' });
  if (existing) {
    console.log(`[seed-founder] A founder account already exists (username: "${existing.username}"). Aborting — nothing was changed.`);
    await mongoose.disconnect();
    process.exit(0);
  }

  const passwordHash = await bcrypt.hash(password, 12);

  await AdminUser.create({
    username,
    email: email.toLowerCase().trim(),
    passwordHash,
    role: 'founder',
    createdBy: 'seed-script'
  });

  console.log(`[seed-founder] SUCCESS: Founder account created for username "${username}".`);
  await mongoose.disconnect();
  process.exit(0);
}

main().catch(err => {
  console.error('[seed-founder] Fatal error:', err.message);
  process.exit(1);
});
