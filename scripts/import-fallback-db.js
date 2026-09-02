'use strict';

/**
 * Move everything captured while the database was down into the database.
 *
 * WHAT HAPPENED
 *
 * When mongoose could not connect, server.js fell through to a JSON engine that
 * reads and writes .data/local_db/db_<Model>.json. The failure was logged as a
 * warning and the process carried on, so the portal kept answering normally:
 * students registered, HR marked attendance, mail went out — all of it into
 * files on one EC2 box, outside every backup, invisible to every other process.
 *
 * The connection now retries and every screen carries a banner, so this cannot
 * happen unnoticed again. This script is for what was captured before that.
 *
 * WHAT IT DOES
 *
 * For each db_<Model>.json it finds, it inserts rows the database does not
 * already have, matched on the model's natural key (employeeId, email, _id).
 * It NEVER overwrites a row that is already in MongoDB: the database is the
 * authority, and a file written during an outage must not be able to roll back
 * something saved after it.
 *
 *     node scripts/import-fallback-db.js              # report only
 *     node scripts/import-fallback-db.js --write      # insert what is missing
 *     node scripts/import-fallback-db.js --only Student
 *
 * Safe to run twice — it only inserts what is absent.
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');

const DB_DIR = path.join(__dirname, '..', '.data', 'local_db');

/**
 * How to tell whether a row is already in the database.
 *
 * Matching on _id alone is not enough: the JSON engine minted its own ids, so
 * the same student can exist under two of them. The natural key is what makes
 * this idempotent.
 */
const KEYS = {
    Student:            ['employeeId', 'email'],
    EcosystemUser:      ['email'],
    Coordinator:        ['username', 'email'],
    HR:                 ['username', 'email'],
    Attendance:         ['employeeId', 'dateKey'],
    Payment:            ['_id'],
    Notification:       ['_id'],
    Message:            ['_id'],
    MailHistory:        ['_id'],
    DocumentHistory:    ['_id'],
    Submission:         ['_id'],

    /*
     * These carry a unique index on something other than _id, so matching on
     * _id alone declared rows "missing" that were already there and the insert
     * then bounced off the index. Taken from each schema's own index() call.
     */
    BadgeAward:          ['employeeId', 'badgeId'],
    StudentTaskProgress: ['studentId', 'taskId'],
    CommunityProfile:    ['userId'],
    MentorProfile:       ['userId'],
    StudentProfile:      ['userId'],
    TalentProfile:       ['userId'],
    StudentCoin:         ['studentId'],
    StudentDocument:     ['studentId'],
    StudentCertificate:  ['certificateId'],
    PsychologyTrigger:   ['studentId', 'triggerName']
};

function keyFor(modelName, doc) {
    const fields = KEYS[modelName] || ['_id'];
    const filter = {};
    for (const f of fields) {
        if (doc[f] === undefined || doc[f] === null || doc[f] === '') return null;
        filter[f] = doc[f];
    }
    return filter;
}

async function main() {
    const write = process.argv.includes('--write');
    const onlyAt = process.argv.indexOf('--only');
    const only = onlyAt > -1 ? process.argv[onlyAt + 1] : null;

    if (!fs.existsSync(DB_DIR)) {
        console.log(`No fallback store at ${DB_DIR} — nothing was captured offline. Good.`);
        return;
    }

    const uri = process.env.MONGODB_URI || process.env.MONGO_URL;
    if (!uri) {
        console.error('No MONGODB_URI in the environment — that is the thing to fix first.');
        process.exitCode = 1;
        return;
    }

    await mongoose.connect(uri, { serverSelectionTimeoutMS: 15000 });
    console.log(write ? 'Importing.\n' : 'Dry run — nothing will be written.\n');

    const files = fs.readdirSync(DB_DIR).filter((f) => /^db_.+\.json$/.test(f));
    let totalMissing = 0;
    let totalInserted = 0;
    let totalAlready = 0;

    for (const file of files) {
        const modelName = file.replace(/^db_/, '').replace(/\.json$/, '');
        if (only && only !== modelName) continue;

        let rows;
        try {
            rows = JSON.parse(fs.readFileSync(path.join(DB_DIR, file), 'utf8'));
        } catch (e) {
            console.log(`${modelName.padEnd(22)} unreadable (${e.message})`);
            continue;
        }
        if (!Array.isArray(rows) || !rows.length) continue;

        /*
         * Models live in two places. Looking only in models/ silently skipped
         * models/new/ — including 260 rows of StudentTaskProgress, which is a
         * student's entire task history.
         */
        let Model = null;
        for (const dir of ['models', 'models/new']) {
            try {
                Model = require(path.join(__dirname, '..', dir, modelName));
                break;
            } catch (_e) { /* try the next directory */ }
        }
        if (!Model) {
            console.log(`${modelName.padEnd(22)} ${rows.length} row(s) — no model named ${modelName}, skipped`);
            continue;
        }

        const missing = [];
        for (const doc of rows) {
            const filter = keyFor(modelName, doc);
            if (!filter) continue;                     // no usable key; leave it alone
            const exists = await Model.exists(filter);
            if (!exists) missing.push(doc);
        }

        totalMissing += missing.length;
        if (!missing.length) {
            console.log(`${modelName.padEnd(22)} ${rows.length} row(s), all already in the database`);
            continue;
        }

        console.log(`${modelName.padEnd(22)} ${rows.length} row(s), ${missing.length} NOT in the database`);
        for (const doc of missing.slice(0, 10)) {
            const label = doc.employeeId || doc.email || doc.name || doc._id;
            console.log(`    ${label}`);
        }
        if (missing.length > 10) console.log(`    … and ${missing.length - 10} more`);

        if (write) {
            let ok = 0;
            let already = 0;
            let failed = 0;
            for (const doc of missing) {
                try {
                    // Let Mongoose mint a fresh _id: the JSON engine's ids are
                    // not ObjectIds and would be rejected or, worse, collide.
                    const clean = Object.assign({}, doc);
                    delete clean._id;
                    delete clean.__v;
                    await Model.create(clean);
                    ok++;
                } catch (e) {
                    if (e.code === 11000) {
                        // A unique index rejected it, which means the row IS
                        // already in the database under a different _id — the
                        // natural key above just did not catch it. Not an error.
                        already++;
                    } else {
                        console.log(`    ! ${doc.employeeId || doc.email || doc._id}: ${e.message}`);
                        failed++;
                    }
                }
            }
            totalInserted += ok;
            totalAlready += already;
            const notes = [`inserted ${ok} of ${missing.length}`];
            if (already) notes.push(`${already} were already there under another id`);
            if (failed)  notes.push(`${failed} failed`);
            console.log(`    ${notes.join(', ')}`);
        }
    }

    console.log('');
    console.log(`${totalMissing} row(s) exist only in the offline file.`);
    if (write) {
        console.log(`${totalInserted} inserted.`);
        if (totalAlready) console.log(`${totalAlready} were already in the database under a different id.`);
    }
    else if (totalMissing) console.log('Re-run with --write to import them.');

    if (write && totalInserted) {
        console.log('\nCheck the portal, then move .data/local_db aside so a future outage');
        console.log('starts from an empty file rather than replaying this one:');
        console.log('  mv .data/local_db .data/local_db.imported-$(date +%F)');
    }

    await mongoose.disconnect();
}

main().catch((err) => {
    console.error('Failed:', err.message);
    process.exitCode = 1;
});
