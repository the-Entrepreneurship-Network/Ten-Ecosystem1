#!/usr/bin/env node
'use strict';

/**
 * Find — and optionally repair — student records whose identity fields would
 * break sign-in.
 *
 * A student whose employeeId is blank, padded with spaces, or duplicated could
 * sign in and then be refused by every request that followed, because those
 * requests looked the account up by that exact field. The code no longer
 * depends on it being perfect, but a malformed record is still worth cleaning:
 * it is what staff search by, and it prints on certificates.
 *
 *   node scripts/repair-student-identity.js                  # report everything
 *   node scripts/repair-student-identity.js TEN/WEB/1643     # one student
 *   node scripts/repair-student-identity.js --fix            # trim + report dupes
 *
 * Reads only, unless --fix is passed. Never prints a password or a hash.
 */

require('dotenv').config();
const mongoose = require('mongoose');

const ARGS = process.argv.slice(2);
const FIX = ARGS.includes('--fix');
const TARGET = ARGS.find((a) => !a.startsWith('--'));

const ok  = (m) => console.log('  ✓ ' + m);
const bad = (m) => console.log('  ✗ ' + m);

async function main() {
  if (!process.env.MONGODB_URI) {
    console.error('MONGODB_URI is not set. Run this on the server, where .env is.');
    process.exit(1);
  }
  await mongoose.connect(process.env.MONGODB_URI);
  const Student = require('../models/Student');

  const filter = TARGET
    ? { $or: [{ employeeId: TARGET }, { email: String(TARGET).toLowerCase() }] }
    : {};
  const students = await Student.find(filter).select('name email employeeId tenure createdAt').lean();

  if (!students.length) {
    console.log(TARGET ? `No student matches "${TARGET}".` : 'No students found.');
    return;
  }

  console.log(`\nChecked ${students.length} student(s)\n${'='.repeat(60)}`);

  const blank = [];
  const padded = [];
  const byId = new Map();

  for (const s of students) {
    const raw = s.employeeId;
    if (!raw || !String(raw).trim()) { blank.push(s); continue; }
    const trimmed = String(raw).trim();
    if (trimmed !== raw) padded.push({ s, trimmed });
    const key = trimmed.toUpperCase();
    byId.set(key, (byId.get(key) || []).concat(s));
  }

  const dupes = [...byId.entries()].filter(([, list]) => list.length > 1);

  if (!blank.length && !padded.length && !dupes.length) {
    ok('every record has a clean, unique employeeId — nothing to repair');
  }

  if (blank.length) {
    bad(`${blank.length} record(s) have NO employeeId:`);
    blank.forEach((s) => console.log(`      ${s.email}  (${s.name || 'no name'})  _id=${s._id}`));
    console.log('      These need an id assigned by staff — this script will not invent one.');
  }

  if (padded.length) {
    bad(`${padded.length} record(s) have whitespace around the employeeId:`);
    padded.forEach(({ s, trimmed }) => console.log(`      ${JSON.stringify(s.employeeId)} -> ${JSON.stringify(trimmed)}  (${s.email})`));
    if (FIX) {
      for (const { s, trimmed } of padded) {
        await Student.updateOne({ _id: s._id }, { $set: { employeeId: trimmed } });
      }
      ok(`trimmed ${padded.length} record(s)`);
    } else {
      console.log('      Re-run with --fix to trim them.');
    }
  }

  if (dupes.length) {
    bad(`${dupes.length} employeeId(s) are used by more than one record:`);
    dupes.forEach(([key, list]) => {
      console.log(`      ${key}`);
      list.forEach((s) => console.log(`        - ${s.email}  _id=${s._id}  created ${s.createdAt}`));
    });
    console.log('      Duplicates are NOT auto-fixed: which row is the real student');
    console.log('      is a decision for staff, and merging the wrong way loses work.');
  }

  console.log('');
}

main()
  .catch((err) => { console.error('Failed:', err.message); process.exitCode = 1; })
  .finally(() => mongoose.connection.close());
