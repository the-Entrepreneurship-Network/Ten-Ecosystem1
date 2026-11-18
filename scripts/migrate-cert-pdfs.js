#!/usr/bin/env node
'use strict';

/**
 * Move the generated PDFs out of the Student documents.
 *
 * Every certificate has always been written twice — a file under uploads/ and
 * the same bytes as base64 on the Student record — and the second copy is what
 * makes a single student record megabytes long. models/Student.js carries
 * three sort indexes purely because of it: without them an HR list blows
 * MongoDB's 100MB in-memory sort limit at around 778 students.
 *
 * The application no longer writes or reads those columns except as a fallback
 * for records this script has not reached, so running it is safe at any point
 * after that deploy, and safe to run again afterwards.
 *
 *   node scripts/migrate-cert-pdfs.js              # report only, changes nothing
 *   node scripts/migrate-cert-pdfs.js --apply      # write files, then clear columns
 *   node scripts/migrate-cert-pdfs.js --apply --type LOC
 *
 * Order matters and is not configurable: a column is cleared only after its
 * file is on disk and has been read back at the expected size. A student whose
 * PDF cannot be written keeps the column and is listed at the end.
 *
 * One type is streamed at a time with a cursor, selecting one PDF column, so
 * peak memory is one certificate rather than the whole collection.
 */

const fs = require('fs');
const mongoose = require('mongoose');
require('dotenv').config();

const Student = require('../models/Student');
const certFile = require('../services/certificateFile');

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const ONLY = (() => {
    const i = args.indexOf('--type');
    return i >= 0 && args[i + 1] ? args[i + 1].toUpperCase() : null;
})();

const TYPES = ONLY ? [ONLY] : certFile.TYPES;

function bail(msg) { console.error(msg); process.exit(1); }

async function run() {
    if (ONLY && !certFile.TYPES.includes(ONLY)) {
        bail(`--type must be one of ${certFile.TYPES.join(', ')}`);
    }
    if (!process.env.MONGODB_URI) {
        bail('MONGODB_URI is not set. Run this on the server, from the app directory.');
    }
    await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 15000 });
    console.log(APPLY ? 'APPLY — files will be written and columns cleared.\n'
                      : 'DRY RUN — nothing will be changed. Re-run with --apply.\n');

    const totals = { already: 0, written: 0, cleared: 0, bytes: 0, failed: [] };

    for (const type of TYPES) {
        const col = certFile.LEGACY_B64[type];
        const cursor = Student.find({ [col]: { $ne: null, $exists: true } })
            .select(`employeeId ${col}`)
            .lean()
            .cursor();

        let n = 0;
        for (let doc = await cursor.next(); doc; doc = await cursor.next()) {
            const b64 = doc[col];
            if (!b64) continue;
            n++;

            const buf = Buffer.from(b64, 'base64');
            const who = doc.employeeId || doc._id;

            if (certFile.findFor(doc, type)) {
                totals.already++;
            } else if (!APPLY) {
                totals.written++;               // would be written
            } else {
                let written = null;
                try {
                    written = certFile.save(doc, type, buf);
                } catch (err) {
                    totals.failed.push(`${who} ${type}: ${err.message}`);
                    continue;
                }
                if (!written) {
                    totals.failed.push(`${who} ${type}: no usable path for this employee ID`);
                    continue;
                }
                /*
                 * Read the size back before trusting it. Clearing the column is
                 * irreversible, and a short write followed by an unset loses
                 * the document outright.
                 */
                const onDisk = fs.statSync(written).size;
                if (onDisk !== buf.length) {
                    totals.failed.push(`${who} ${type}: wrote ${onDisk} of ${buf.length} bytes`);
                    try { fs.unlinkSync(written); } catch (_) {}
                    continue;
                }
                totals.written++;
            }

            if (APPLY) {
                await Student.updateOne({ _id: doc._id }, { $unset: { [col]: '' } });
                totals.cleared++;
            }
            // Only here: every path that could not place the file has already
            // skipped past, so this counts what actually leaves the database.
            totals.bytes += buf.length;
        }
        console.log(`${type.padEnd(6)} ${n} record(s) carrying a base64 copy`);
    }

    const mb = (totals.bytes / 1024 / 1024).toFixed(1);
    console.log(`\nalready on disk : ${totals.already}`);
    console.log(`written to disk : ${totals.written}`);
    console.log(`columns cleared : ${totals.cleared}`);
    console.log(`reclaimed       : ~${mb} MB`);
    if (totals.failed.length) {
        console.log(`\n${totals.failed.length} left untouched:`);
        for (const f of totals.failed) console.log('  ' + f);
    }
    if (!APPLY) console.log('\nDry run. Re-run with --apply to make these changes.');

    await mongoose.disconnect();
}

if (require.main === module) {
    run().catch((err) => { console.error(err); process.exit(1); });
}

module.exports = { run };
