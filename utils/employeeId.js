'use strict';

/**
 * Employee-ID generation and availability, in one place.
 *
 * There used to be two copies of this — server.js and
 * controllers/registerHubController.js — with different domain maps and
 * different unknown-domain fallbacks, so the same student could get
 * TEN/FOO/1002 from one route and TEN/GEN/1002 from the other. Both derived the
 * sequence from Student.countDocuments(), which collides under concurrency and
 * rewinds on deletion (see models/Counter.js).
 */

const Counter = require('../models/Counter');
const Student = require('../models/Student');
const { getDomainShortCode } = require('../config/domains');

const COUNTER_NAME = 'employeeId';
const FIRST_SEQUENCE = 1001;

/** TEN/<CODE>/<number> — the shape printed on offer letters and certificates. */
function formatEmployeeId(shortCode, sequence) {
    return `TEN/${shortCode}/${sequence}`;
}

/**
 * Highest sequence number currently in use, so the counter can be advanced past
 * any IDs that predate it.
 */
async function findHighestExistingSequence() {
    try {
        const students = await Student.find({ employeeId: { $ne: null } })
            .select('employeeId')
            .lean();
        let highest = 0;
        for (const s of students) {
            const match = /\/(\d+)\s*$/.exec(s.employeeId || '');
            if (!match) continue;
            const n = Number.parseInt(match[1], 10);
            if (Number.isFinite(n) && n > highest) highest = n;
        }
        return highest;
    } catch (err) {
        console.error('[employeeId] Could not scan existing IDs:', err.message);
        return 0;
    }
}

/**
 * Align the counter with the IDs already issued. Call once at startup —
 * without it the first generated ID after deploying would collide with an
 * existing student.
 */
async function initEmployeeIdCounter() {
    const highest = await findHighestExistingSequence();
    if (highest >= FIRST_SEQUENCE) {
        await Counter.ensureAtLeast(COUNTER_NAME, highest - FIRST_SEQUENCE + 1);
        console.log(`[employeeId] Counter aligned past the highest existing ID (${highest}).`);
    }
}

/**
 * Generate the next employee ID for a domain.
 *
 * Retries on the vanishingly rare case where the reserved number is already
 * taken (an ID created outside this generator).
 */
async function generateEmployeeId(domain, { maxAttempts = 5 } = {}) {
    const shortCode = getDomainShortCode(domain);

    let realigned = false;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const sequence = await Counter.next(COUNTER_NAME, FIRST_SEQUENCE);
        const candidate = formatEmployeeId(shortCode, sequence);
        const clash = await Student.findOne({ employeeId: candidate }).select('_id').lean();
        if (!clash) return candidate;

        // A clash means the counter is BEHIND the IDs actually in use.
        //
        // initEmployeeIdCounter() is supposed to prevent that at startup, but
        // it ran inside the server.listen callback, which fires before the
        // database connection is established — so the scan could come back
        // empty and leave the counter at zero. New students were then issued
        // 1004, 1005, 1006 while real students already held 1758 and 1759.
        //
        // Retrying +1 cannot recover from that: it crawls one number at a time
        // through hundreds of taken IDs and gives up after maxAttempts. Re-align
        // once from the real data instead, then carry on from the true top.
        if (!realigned) {
            realigned = true;
            await initEmployeeIdCounter();
            console.warn(`[employeeId] ${candidate} was taken — counter re-aligned from the IDs in the database.`);
            continue;
        }

        console.warn(`[employeeId] ${candidate} is already taken; taking the next number.`);
    }
    throw new Error('Could not allocate a unique employee ID. Please try again.');
}

/**
 * Is an employee ID free?
 * Backs the pre-submit availability check on the registration form, so a
 * student sees "already taken" inline instead of a generic server error.
 *
 * @param {string} employeeId
 * @param {string} [excludeStudentId] ignore this student (for edits)
 */
async function isEmployeeIdAvailable(employeeId, excludeStudentId = null) {
    const value = String(employeeId || '').trim();
    if (!value) return { available: false, reason: 'Employee ID is required.' };
    if (value.length > 50) return { available: false, reason: 'That Employee ID is too long.' };
    if (!/^[A-Za-z0-9/_-]+$/.test(value)) {
        return { available: false, reason: 'Employee IDs may only contain letters, numbers, slashes, hyphens and underscores.' };
    }

    const query = { employeeId: value };
    if (excludeStudentId) query._id = { $ne: excludeStudentId };

    const existing = await Student.findOne(query).select('_id').lean();
    if (existing) {
        return { available: false, reason: 'This Employee ID is already taken.' };
    }
    return { available: true };
}

module.exports = {
    COUNTER_NAME,
    FIRST_SEQUENCE,
    formatEmployeeId,
    generateEmployeeId,
    isEmployeeIdAvailable,
    initEmployeeIdCounter,
    findHighestExistingSequence
};
