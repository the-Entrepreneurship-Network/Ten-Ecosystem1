'use strict';

/**
 * Grow every student's task track without anyone going backwards.
 *
 * WHAT CHANGED
 *
 * The short tenures had almost no work in them. services/v2/taskEngine.js used
 * to rewrite 1week and 15days onto the 1-month track and take week 1, or weeks
 * 1 and 2 — so a one-week internship handed out ONE task and a fifteen-day
 * internship TWO, while the free six-month track handed out twenty-four. Paying
 * for a shorter course bought less work than not paying at all.
 *
 * Each tenure now has a real track: 4 / 6 / 8 / 10 / 12 / 24 weeks.
 *
 * THE PROBLEM THIS SCRIPT SOLVES
 *
 * Completion is `approved / assigned`. Lengthening a track moves the
 * denominator under a student who is already part-way through one: somebody at
 * 4 of 4 wakes up at 4 of 8, having done nothing wrong. An LOR needs 50%, so
 * that student could be refused a document they had already qualified for.
 *
 * So before touching anything, this records what each student's percentage was.
 * Where the number falls, `preExpansionCompletionPercent` keeps the old figure
 * and every gate reads the better of the two. Their real progress still counts
 * up from where it is — nothing is faked, and nothing is taken away.
 *
 *     node seeds/domainTasks.seed.js              # 1. write the new tracks
 *     node scripts/expand-task-tracks.js          # 2. dry run — changes nothing
 *     node scripts/expand-task-tracks.js --write  # 3. apply
 *
 * Safe to run twice: a student who already carries a recorded figure is left
 * alone, so a second run cannot lower the protection a first run gave them.
 */

require('dotenv').config();
const mongoose = require('mongoose');

const LOR_THRESHOLD = 50;

/** approved / assigned, as a whole number. */
async function completionOf(StudentTaskProgress, studentId) {
    const [total, approved] = await Promise.all([
        StudentTaskProgress.countDocuments({ studentId }),
        StudentTaskProgress.countDocuments({ studentId, status: 'approved' })
    ]);
    return { total, approved, percent: total > 0 ? Math.round((approved / total) * 100) : 0 };
}

async function main() {
    const write = process.argv.includes('--write');
    const uri = process.env.MONGODB_URI;
    if (!uri) {
        console.error('No MONGODB_URI in the environment — that is the thing to fix first.');
        process.exitCode = 1;
        return;
    }
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 15000 });

    const Student = require('../models/Student');
    const StudentTaskProgress = require('../models/new/StudentTaskProgress');
    const { resyncTasksForStudent } = require('../services/v2/taskEngine');

    console.log(write ? 'Applying.\n' : 'Dry run — nothing will be written.\n');

    const students = await Student.find({}).select(
        'name email employeeId domain tenure v2DurationType preExpansionCompletionPercent'
    );
    console.log(`${students.length} student(s) to look at.\n`);

    const protectedNow = [];
    const grew = [];
    let unchanged = 0;
    let failed = 0;

    for (const student of students) {
        let before;
        try {
            before = await completionOf(StudentTaskProgress, student._id);
        } catch (err) {
            console.log(`  ! ${student.employeeId || student.email}: ${err.message}`);
            failed++;
            continue;
        }

        if (!write) {
            // Without writing we cannot know the new denominator for certain, so
            // report the standing that would need protecting and stop there.
            if (before.percent >= LOR_THRESHOLD) {
                protectedNow.push({ student, before, after: null });
            } else {
                unchanged++;
            }
            continue;
        }

        try {
            const result = await resyncTasksForStudent(student);
            const after = await completionOf(StudentTaskProgress, student._id);

            if (after.total > before.total) grew.push({ student, before, after, result });

            // Only ever record a DROP, only once, and never overwrite a figure a
            // previous run already protected them with.
            if (after.percent < before.percent && student.preExpansionCompletionPercent == null) {
                student.preExpansionCompletionPercent = before.percent;
                student.trackExpandedAt = new Date();
                await student.save();
                protectedNow.push({ student, before, after });
            } else if (after.total === before.total) {
                unchanged++;
            }
        } catch (err) {
            console.log(`  ! ${student.employeeId || student.email}: ${err.message}`);
            failed++;
        }
    }

    const label = (s) => `${(s.employeeId || s.email || s._id)}`.padEnd(18)
        + `${(s.name || '').slice(0, 22).padEnd(24)}`
        + `${(s.v2DurationType || s.tenure || '?')}`;

    if (write) {
        console.log(`Tracks grew for ${grew.length} student(s).`);
        console.log(`${unchanged} unaffected. ${failed} could not be read.\n`);
        if (protectedNow.length) {
            console.log('Standing preserved — these students would otherwise have gone backwards:');
            protectedNow.forEach(({ student, before, after }) => {
                console.log(`  ${label(student)}  ${before.approved}/${before.total} (${before.percent}%)`
                    + `  ->  ${after.approved}/${after.total} (${after.percent}%)`
                    + `   protected at ${before.percent}%`);
            });
            console.log('\nEvery gate reads the better of the two, so none of them lose an LOR.');
        } else {
            console.log('Nobody went backwards. No protection was needed.');
        }
    } else {
        console.log(`${protectedNow.length} student(s) are at or above ${LOR_THRESHOLD}% today `
            + 'and would be protected if their track grows:');
        protectedNow.slice(0, 25).forEach(({ student, before }) => {
            console.log(`  ${label(student)}  ${before.approved}/${before.total} (${before.percent}%)`);
        });
        if (protectedNow.length > 25) console.log(`  … and ${protectedNow.length - 25} more`);
        console.log(`\n${unchanged} are below it. ${failed} could not be read.`);
        console.log('\nRe-run with --write to apply. Run the seeder first if you have not:');
        console.log('  node seeds/domainTasks.seed.js');
    }

    await mongoose.disconnect();
}

main().catch((err) => {
    console.error('Failed:', err.message);
    process.exitCode = 1;
});
