/**
 * Repair student records whose name is missing, blank, or the literal
 * "undefined".
 *
 * The admin console printed `undefined` in the Name column for these, and its
 * Edit form was pre-filled from what the table had just rendered — so opening a
 * broken row and pressing Save wrote the word "undefined" in as the student's
 * real name. Both of those are fixed at the source now (a pre-save hook on the
 * model and an escaped Edit form), but the rows already written need repairing.
 *
 * Sources, best first:
 *   1. firstName + lastName on the same document
 *   2. StudentProfile.fullName, matched on email
 *   3. EcosystemUser.fullName, matched on email
 *   4. the email local part, tidied — imperfect, but identifiable
 *
 * DRY RUN BY DEFAULT. It prints what it would do and writes nothing.
 * Pass --apply to write.
 *
 *   node scripts/backfill-student-names.js            # report only
 *   node scripts/backfill-student-names.js --apply    # repair
 */

require('dotenv').config();
const mongoose = require('mongoose');

const Student = require('../models/Student');
const { deriveStudentName, isUsableName } = require('../models/Student');

const APPLY = process.argv.includes('--apply');

async function main() {
    const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
    if (!uri) {
        console.error('MONGODB_URI is not set. Run this on the server, beside the .env.');
        process.exit(1);
    }
    await mongoose.connect(uri);
    console.log(APPLY ? 'MODE: APPLY — records will be written.\n' : 'MODE: DRY RUN — nothing will be written. Pass --apply to repair.\n');

    // Load the two profile collections once and index by email, rather than
    // querying per student: this runs over the whole students collection.
    let profileByEmail = new Map();
    let ecoByEmail = new Map();
    for (const [modelPath, target] of [
        ['../models/StudentProfile', profileByEmail],
        ['../models/EcosystemUser', ecoByEmail],
    ]) {
        try {
            const Model = require(modelPath);
            const rows = await Model.find({}).select('email fullName').lean();
            rows.forEach(r => {
                const key = String(r.email || '').toLowerCase().trim();
                if (key && isUsableName(r.fullName)) target.set(key, r.fullName.trim());
            });
        } catch (err) {
            console.log(`  (skipping ${modelPath}: ${err.message})`);
        }
    }

    const students = await Student.find({})
        .select('_id name firstName lastName email employeeId')
        .lean();

    const broken = students.filter(s => !isUsableName(s.name));
    console.log(`${students.length} students, ${broken.length} with no usable name.\n`);
    if (!broken.length) {
        await mongoose.disconnect();
        return;
    }

    const bySource = { fields: 0, profile: 0, ecosystem: 0, email: 0, unresolved: 0 };
    const writes = [];

    for (const s of broken) {
        const email = String(s.email || '').toLowerCase().trim();
        let name = '';
        let source = '';

        const fromFields = deriveStudentName({ firstName: s.firstName, lastName: s.lastName });
        if (fromFields) { name = fromFields; source = 'fields'; }
        else if (profileByEmail.has(email)) { name = profileByEmail.get(email); source = 'profile'; }
        else if (ecoByEmail.has(email)) { name = ecoByEmail.get(email); source = 'ecosystem'; }
        else {
            const fromEmail = deriveStudentName({ email: s.email });
            if (fromEmail) { name = fromEmail; source = 'email'; }
        }

        if (!name) {
            bySource.unresolved++;
            console.log(`  UNRESOLVED  ${s.employeeId || s._id}  <${s.email || 'no email'}>`);
            continue;
        }
        bySource[source]++;
        console.log(`  ${source.padEnd(9)}  ${String(s.employeeId || s._id).padEnd(34)}  ${JSON.stringify(s.name)} -> ${JSON.stringify(name)}`);
        writes.push({ updateOne: { filter: { _id: s._id }, update: { $set: { name } } } });
    }

    console.log('\nBy source:', bySource);

    if (!APPLY) {
        console.log(`\nDry run. ${writes.length} record(s) would be repaired. Re-run with --apply to write.`);
    } else if (writes.length) {
        // bulkWrite bypasses the model's pre-update hook, which is fine here:
        // every value was produced by deriveStudentName and is usable by
        // construction. Guarded anyway so a future edit cannot regress it.
        const safe = writes.filter(w => isUsableName(w.updateOne.update.$set.name));
        const res = await Student.bulkWrite(safe);
        console.log(`\nRepaired ${res.modifiedCount} record(s).`);
        if (safe.length !== writes.length) {
            console.log(`Refused ${writes.length - safe.length} unusable name(s).`);
        }
    }

    if (bySource.unresolved) {
        console.log(`\n${bySource.unresolved} record(s) have nothing to derive a name from — set those by hand in the admin console (Students -> Edit).`);
    }

    await mongoose.disconnect();
}

main().catch(err => { console.error(err); process.exit(1); });
