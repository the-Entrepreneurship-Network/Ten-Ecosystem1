#!/usr/bin/env node
'use strict';

/**
 * Make attendance independent per domain.
 *
 * Two things have to happen on the live database, and neither is something
 * Mongoose will do on its own:
 *
 *  1. Drop the old unique index `{employeeId, dateKey, markedBy}`.
 *     Mongoose creates the new four-key index at boot but never removes an
 *     index it no longer declares. While the old one exists, a student holding
 *     two domains can still only mark attendance once per day in total —
 *     exactly the bug the new index fixes.
 *
 *  2. Backfill `domain` on rows that have none. `Attendance.domain` defaults
 *     to "", and older rows still carry that default. The read path already
 *     attributes a blank row to the student's primary domain, but the unique
 *     index treats "" as a distinct value, so leaving them blank would let a
 *     student mark the same day twice in their primary domain (once against
 *     "" and once against the real name).
 *
 * Dry run by default — it reports and changes nothing. Pass --apply to write.
 *
 *   node scripts/migrate-attendance-domain-index.js
 *   node scripts/migrate-attendance-domain-index.js --apply
 */

require('dotenv').config();
const mongoose = require('mongoose');

const APPLY = process.argv.includes('--apply');
const OLD_INDEX_KEY = { employeeId: 1, dateKey: 1, markedBy: 1 };

function sameKey(a, b) {
  const ak = Object.keys(a);
  const bk = Object.keys(b);
  return ak.length === bk.length && ak.every((k) => a[k] === b[k]);
}

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('MONGODB_URI is not set. Run this on the server, where .env is.');
    process.exit(1);
  }

  await mongoose.connect(uri);
  console.log(`Connected. Mode: ${APPLY ? 'APPLY' : 'DRY RUN'}\n`);

  const Student = require('../models/Student');
  const Attendance = require('../models/Attendance');
  const { primaryDomain } = require('../utils/attendanceDomain');

  // ---- 1. Backfill blank domains -----------------------------------------
  const blanks = await Attendance.find({
    $or: [{ domain: '' }, { domain: null }, { domain: { $exists: false } }]
  }).select('_id employeeId dateKey markedBy').lean();

  console.log(`Rows with no domain: ${blanks.length}`);

  const byEmployee = new Map();
  for (const row of blanks) {
    if (!byEmployee.has(row.employeeId)) byEmployee.set(row.employeeId, []);
    byEmployee.get(row.employeeId).push(row);
  }

  let filled = 0;
  let unresolved = 0;
  let collisions = 0;

  for (const [employeeId, rows] of byEmployee) {
    const student = await Student.findOne({ employeeId })
      .select('domain domains linkedDomains').lean();
    const target = primaryDomain(student);

    if (!target) {
      unresolved += rows.length;
      continue;
    }

    for (const row of rows) {
      // A row already exists under the real domain name for the same day and
      // source? Then this blank row is a duplicate and must go, or the new
      // unique index cannot be built.
      const duplicate = await Attendance.findOne({
        employeeId,
        dateKey: row.dateKey,
        markedBy: row.markedBy,
        domain: target,
        _id: { $ne: row._id }
      }).select('_id').lean();

      if (duplicate) {
        collisions++;
        if (APPLY) await Attendance.deleteOne({ _id: row._id });
      } else {
        filled++;
        if (APPLY) await Attendance.updateOne({ _id: row._id }, { $set: { domain: target } });
      }
    }
  }

  console.log(`  → would set domain on : ${filled}`);
  console.log(`  → duplicate, would drop: ${collisions}`);
  console.log(`  → no student found     : ${unresolved}  (left as-is)\n`);

  // ---- 2. Drop the old index ---------------------------------------------
  const collection = Attendance.collection;
  const indexes = await collection.indexes();
  const stale = indexes.filter((ix) => ix.unique && sameKey(ix.key, OLD_INDEX_KEY));

  if (!stale.length) {
    console.log('Old unique index {employeeId, dateKey, markedBy}: already gone.');
  } else {
    for (const ix of stale) {
      console.log(`Old unique index found: ${ix.name}`);
      if (APPLY) {
        await collection.dropIndex(ix.name);
        console.log(`  → dropped ${ix.name}`);
      }
    }
  }

  // ---- 3. Ensure the new index exists -------------------------------------
  const hasNew = indexes.some((ix) =>
    sameKey(ix.key, { employeeId: 1, dateKey: 1, markedBy: 1, domain: 1 }));

  if (hasNew) {
    console.log('New index {employeeId, dateKey, markedBy, domain}: present.');
  } else if (APPLY) {
    await collection.createIndex(
      { employeeId: 1, dateKey: 1, markedBy: 1, domain: 1 },
      { unique: true }
    );
    console.log('New index {employeeId, dateKey, markedBy, domain}: created.');
  } else {
    console.log('New index {employeeId, dateKey, markedBy, domain}: would be created.');
  }

  if (!APPLY) {
    console.log('\nNothing was written. Re-run with --apply to make these changes.');
  } else {
    console.log('\nDone.');
  }

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error('Migration failed:', err.message);
  process.exit(1);
});
