#!/usr/bin/env node
'use strict';

/**
 * Will people stay signed in across a restart?
 *
 * Two things decide it, and if either is wrong every signed-in person is thrown
 * out the moment the app restarts — while a private window, signing in fresh
 * afterwards, works perfectly. That difference is what makes this so confusing
 * to report: "it works in incognito but not in normal Chrome".
 *
 *   1. The signing key must be the same after a restart. Every cookie is signed
 *      with it; a new key makes every existing cookie invalid.
 *   2. The session store must outlive the process. MongoDB does; the in-memory
 *      fallback does not.
 *
 *   node scripts/diagnose-session.js
 *
 * Reads only. Prints no secret — only whether one is present and how long.
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');

const ok   = (m) => console.log('  \x1b[32m✓\x1b[0m ' + m);
const bad  = (m) => console.log('  \x1b[31m✗\x1b[0m ' + m);
const warn = (m) => console.log('  \x1b[33m!\x1b[0m ' + m);

async function main() {
  console.log('\nSession durability\n' + '='.repeat(58));

  // ── 1. the signing key ──────────────────────────────────────────────
  console.log('\n1. Cookie signing key');
  const envSecret = (process.env.SESSION_SECRET || '').trim();
  const secretFile = path.join(__dirname, '..', '.session-secret');
  const hasFile = fs.existsSync(secretFile);

  let stable = false;
  if (envSecret) {
    stable = true;
    if (envSecret.length < 32) warn(`SESSION_SECRET is set but only ${envSecret.length} chars — 32+ is expected.`);
    else ok(`SESSION_SECRET is set in .env (${envSecret.length} chars). Survives restarts.`);
  } else if (hasFile) {
    const saved = fs.readFileSync(secretFile, 'utf8').trim();
    if (saved.length >= 32) {
      stable = true;
      ok('SESSION_SECRET is not in .env, but a generated key is saved in .session-secret.');
      console.log('      Sessions survive restarts. Setting a real one in .env is still better:');
      console.log('      node -e "console.log(\'SESSION_SECRET=\' + require(\'crypto\').randomBytes(32).toString(\'hex\'))" >> .env');
    } else {
      bad('.session-secret exists but is too short to use — a new key will be generated.');
    }
  } else {
    bad('No SESSION_SECRET and no .session-secret yet.');
    console.log('      A key will be generated and saved on the next start, and from then on');
    console.log('      restarts keep people signed in. THIS restart still signs everyone out.');
  }

  // ── 2. where sessions live ──────────────────────────────────────────
  console.log('\n2. Session store');
  if (!process.env.MONGODB_URI) {
    bad('MONGODB_URI is not set — sessions would live in memory and die with the process.');
    stable = false;
  } else {
    const mongoose = require('mongoose');
    try {
      await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 8000 });
      ok('MongoDB is reachable — sessions are stored there and outlive a restart.');
      const n = await mongoose.connection.db.collection('sessions').countDocuments();
      console.log(`      ${n} session document(s) currently stored.`);
      await mongoose.connection.close();
    } catch (err) {
      bad(`MongoDB is NOT reachable (${err.message}).`);
      console.log('      Sessions fall back to memory, so every restart signs everyone out.');
      stable = false;
    }
  }

  // ── 3. cookie flags ─────────────────────────────────────────────────
  console.log('\n3. Cookie settings');
  const isProd = process.env.NODE_ENV === 'production';
  console.log(`      NODE_ENV = ${process.env.NODE_ENV || '(unset)'}`);
  if (isProd) ok('secure + sameSite=none — correct for an HTTPS site behind nginx.');
  else warn('NODE_ENV is not "production": cookies are not marked Secure, and the');
  if (!isProd) console.log('      required-secrets check that would refuse an unsafe boot never runs.');

  console.log('\n' + '='.repeat(58));
  if (stable) console.log('Verdict: a restart should NOT sign people out.\n');
  else console.log('Verdict: a restart WILL sign people out. Fix the ✗ above.\n');
}

main().catch((err) => { console.error('Failed:', err.message); process.exitCode = 1; });
