'use strict';

/**
 * Recalculate attendance for every student, once, after the back-date fix.
 *
 * WHY THIS EXISTS
 *
 * The onboarding card that asks a WhatsApp joiner for their original start date
 * had no lower bound. Whatever date they typed, every working day between it
 * and their portal registration was credited as attended — and
 * getAttendanceSummary caps the total at the working days elapsed, so a date
 * roughly one tenure back filled that cap exactly. A student with nothing
 * recorded against them could type a date and read 100%, eligible for a
 * certificate.
 *
 * Nothing stopped it being done twice, either: the endpoint had no re-entry
 * check, so the "asked once" rule lived only in the browser.
 *
 * The code no longer allows it. This script deals with the records written
 * while it did.
 *
 * WHAT IT DOES, per student:
 *
 *   1. Flags a pre-portal claim that would satisfy the whole 75% requirement on
 *      its own. Those days stop counting until HR confirms them. The claim is
 *      NOT deleted — a real four-month WhatsApp joiner exists, and this script
 *      cannot tell them apart from someone who typed a number. That is the
 *      point of asking a human.
 *   2. Repairs joiningDate when it predates the account's own creation. That
 *      cannot be a portal registration date; it is the fingerprint of the old
 *      wizard overwriting the field.
 *   3. Recomputes internshipEndDate from the start date and tenure. Nothing
 *      used to, and the certificate now prints it.
 *   4. Rewrites calculatedAttendance and the percentages from the real
 *      Attendance rows.
 *
 * WHAT IT NEVER TOUCHES: attendance records, tasks, submissions, coins,
 * certificates, documents, employee IDs. It only recomputes figures that are
 * derived from data it leaves alone.
 *
 * Run it:
 *
 *     node scripts/recalculate-attendance.js              # report only
 *     node scripts/recalculate-attendance.js --write      # apply
 *     node scripts/recalculate-attendance.js --csv out.csv
 *
 * Safe to run twice — it is a recalculation, not an increment.
 */

require('dotenv').config();
const mongoose = require('mongoose');

const Student = require('../models/Student');
const Attendance = require('../models/Attendance');
const {
    getAttendanceSummary,
    getAccountAnchorDate,
    getTenureEndDate,
    claimNeedsReview
} = require('../utils/attendanceUtils');

const pct = (n) => String(n == null ? '—' : n + '%').padStart(5);

async function main() {
    const write = process.argv.includes('--write');
    const csvAt = process.argv.indexOf('--csv');
    const csvPath = csvAt > -1 ? process.argv[csvAt + 1] : null;

    const uri = process.env.MONGODB_URI || process.env.MONGO_URL;
    if (!uri) {
        console.error('No MONGODB_URI in the environment. Nothing to connect to.');
        process.exitCode = 1;
        return;
    }

    await mongoose.connect(uri);
    console.log(write ? 'Recalculating and WRITING.\n' : 'Dry run — nothing will be written.\n');

    const students = await Student.find({})
        .select('employeeId name firstName lastName domain tenure v2DurationType joinerType '
              + 'joiningDate internshipStartDate internshipEndDate createdAt '
              + 'calculatedAttendance attendancePercentage preportalAbsentDays '
              + 'preportalCreditNeedsReview preportalCreditConfirmedAt')
        .lean();

    console.log(`${students.length} student(s) on the roster.\n`);

    const changed = [];
    const flagged = [];
    const repaired = [];
    let unchanged = 0;

    for (const s of students) {
        const rows = await Attendance.find({ employeeId: s.employeeId })
            .select('status date dateKey markedBy')
            .lean();

        const before = {
            percentage: s.attendancePercentage == null ? null : Number(s.attendancePercentage),
            days: s.calculatedAttendance == null ? null : Number(s.calculatedAttendance)
        };

        const updates = {};

        /*
         * 2 — a joiningDate before the row existed is not a registration date.
         * Repaired first, because the anchor everything else measures from is
         * derived from it.
         */
        const created = s.createdAt ? new Date(s.createdAt) : null;
        const joined = s.joiningDate ? new Date(s.joiningDate) : null;
        const joiningIsImpossible = !!(created && joined && !isNaN(joined.getTime()) && joined < created);
        if (joiningIsImpossible) {
            updates.joiningDate = created.toISOString().slice(0, 10);
            repaired.push({ s, from: joined, to: created });
        }

        const repairedStudent = Object.assign({}, s, updates);

        // 1 — does the claim cover the whole requirement by itself?
        const needsReview = s.joinerType === 'whatsapp'
            && claimNeedsReview(s.internshipStartDate, repairedStudent);
        if (needsReview !== !!s.preportalCreditNeedsReview) {
            updates.preportalCreditNeedsReview = needsReview;
        }
        // An existing confirmation stands. HR confirmed a claim; the claim has
        // not changed, only the code that reads it.
        const forCalc = Object.assign({}, repairedStudent, updates);

        // 3 — the end date follows the start date.
        const start = forCalc.joinerType === 'whatsapp'
            ? (forCalc.internshipStartDate || forCalc.joiningDate)
            : (forCalc.joiningDate || forCalc.internshipStartDate);
        const end = start ? getTenureEndDate(start, forCalc.tenure || forCalc.v2DurationType) : null;
        if (end && (!s.internshipEndDate || new Date(s.internshipEndDate).getTime() !== end.getTime())) {
            updates.internshipEndDate = end;
        }

        // 4 — the figures, from the rows that actually exist.
        const summary = getAttendanceSummary(rows, forCalc);
        if (before.percentage !== summary.percentage || before.days !== summary.daysPresent) {
            updates.calculatedAttendance = summary.daysPresent;
            updates.calculatedAttendancePercentage = summary.percentage;
            updates.attendancePercentage = summary.percentage;
            updates.attendanceLastCalculated = new Date();
        }

        if (!Object.keys(updates).length) { unchanged++; continue; }

        const row = {
            employeeId: s.employeeId,
            name: s.name || `${s.firstName || ''} ${s.lastName || ''}`.trim(),
            domain: s.domain || '',
            joinerType: s.joinerType || '',
            beforePct: before.percentage,
            afterPct: summary.percentage,
            beforeDays: before.days,
            afterDays: summary.daysPresent,
            credit: summary.preportalCreditedDays,
            tracked: summary.trackedDaysPresent,
            needsReview,
            joiningRepaired: joiningIsImpossible
        };
        changed.push(row);
        if (needsReview) flagged.push(row);

        if (write) {
            await Student.updateOne({ _id: s._id }, { $set: updates });
        }
    }

    // ── the report ──────────────────────────────────────────────────────────
    const dropped = changed.filter((r) => r.beforePct != null && r.afterPct < r.beforePct);
    const raised = changed.filter((r) => r.beforePct != null && r.afterPct > r.beforePct);

    console.log(`unchanged            ${unchanged}`);
    console.log(`recalculated         ${changed.length}`);
    console.log(`  attendance fell    ${dropped.length}`);
    console.log(`  attendance rose    ${raised.length}`);
    console.log(`joiningDate repaired ${repaired.length}`);
    console.log(`held for HR review   ${flagged.length}\n`);

    if (dropped.length) {
        console.log('THESE STUDENTS WILL SEE A LOWER FIGURE — tell them before they notice:\n');
        console.log('  employee id            was    now   tracked  credit  name');
        for (const r of dropped.sort((a, b) => (a.afterPct - a.beforePct) - (b.afterPct - b.beforePct)).slice(0, 60)) {
            console.log(`  ${String(r.employeeId).padEnd(20)} ${pct(r.beforePct)} ${pct(r.afterPct)}`
                + `  ${String(r.tracked).padStart(6)}  ${String(r.credit).padStart(6)}  ${r.name}`);
        }
        if (dropped.length > 60) console.log(`  … and ${dropped.length - 60} more (use --csv for the full list)`);
        console.log();
    }

    if (flagged.length) {
        console.log('PRE-PORTAL CLAIMS HELD FOR HR — these cover the whole requirement on their own:\n');
        for (const r of flagged.slice(0, 60)) {
            console.log(`  ${String(r.employeeId).padEnd(20)} claim worth ${String(r.credit).padStart(4)} days`
                + `, actually attended ${String(r.tracked).padStart(4)}  ${r.name}`);
        }
        if (flagged.length > 60) console.log(`  … and ${flagged.length - 60} more`);
        console.log('\n  Confirm a genuine one by setting preportalCreditConfirmedAt on that student.');
        console.log('  Correct a partly-genuine one with preportalAbsentDays.\n');
    }

    if (csvPath) {
        const esc = (v) => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
        const lines = ['employeeId,name,domain,joinerType,beforePct,afterPct,beforeDays,afterDays,trackedDays,creditedDays,heldForReview,joiningDateRepaired'];
        for (const r of changed) {
            lines.push([r.employeeId, r.name, r.domain, r.joinerType, r.beforePct, r.afterPct,
                r.beforeDays, r.afterDays, r.tracked, r.credit, r.needsReview, r.joiningRepaired].map(esc).join(','));
        }
        require('fs').writeFileSync(csvPath, lines.join('\n'), 'utf8');
        console.log(`Full list written to ${csvPath}\n`);
    }

    if (!write && changed.length) {
        console.log('Nothing was written. Re-run with --write to apply.');
    }

    await mongoose.disconnect();
}

main().catch((err) => {
    console.error('Failed:', err.message);
    process.exitCode = 1;
});
