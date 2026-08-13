"use strict";

/**
 * The single place that decides whether a student may apply for a certificate.
 *
 * The rules, as specified:
 *
 *   LOC  — the internship is complete AND attendance is above 75%
 *   LOR  — performance is above 70%
 *   STAR — HR has accepted the student's contribution (starStatus 'approved')
 *
 * Every consumer asks this module rather than re-implementing a threshold:
 * the student portal to decide whether a button is enabled, the apply route to
 * accept or refuse the request, and the HR approval route to re-check before
 * issuing. The thresholds existing in one place is the point — the tenure
 * tables in this project once existed in five, disagreed, and silently gave
 * every student a 30-day internship.
 *
 * Returns, for each type: whether it is eligible, a human-readable reason when
 * it is not, and the measured values behind the decision — so a student is
 * told "attendance 68%, needs above 75%" rather than a locked button with no
 * explanation.
 */

const StudentTaskProgress = require("../models/new/StudentTaskProgress");

const THRESHOLDS = {
    LOC_MIN_ATTENDANCE:  75,
    LOR_MIN_PERFORMANCE: 70
};

/** Attendance/performance are stored as 0–100 numbers; be defensive anyway. */
function pct(value) {
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0) return 0;
    return n > 100 ? 100 : n;
}

/**
 * How much of the assigned task journey is approved, as a percentage.
 * Used as a fallback signal for "completed" when the flag was never set.
 */
async function taskCompletionPercent(studentId) {
    try {
        const [total, approved] = await Promise.all([
            StudentTaskProgress.countDocuments({ studentId }),
            StudentTaskProgress.countDocuments({ studentId, status: "approved" })
        ]);
        if (!total) return 0;
        return Math.round((approved / total) * 100);
    } catch (err) {
        console.error("[eligibility] task completion lookup failed:", err.message);
        return 0;
    }
}

/**
 * `internshipCompleted` exists twice on the schema — a Boolean and a Date
 * inside `milestones` — written by different code paths. Treat either as
 * completion, and accept a fully-approved task journey as evidence too, so a
 * student who finished everything is not blocked by a flag nobody set.
 */
function isCompleted(student, taskPercent) {
    if (student.internshipCompleted === true) return true;
    if (student.internshipCompletedAt) return true;
    if (student.milestones && student.milestones.internshipCompleted) return true;
    return taskPercent >= 100;
}

/**
 * Evaluate every certificate type for one student.
 *
 * @param {object} student a Student document (or lean object)
 * @returns {Promise<{LOC:object, LOR:object, STAR:object, measured:object}>}
 */
async function evaluate(student) {
    if (!student) {
        const blocked = { eligible: false, reason: "Student record not found." };
        return { LOC: blocked, LOR: blocked, STAR: blocked, measured: {} };
    }

    const taskPercent  = await taskCompletionPercent(student._id);
    const attendance   = pct(student.attendancePercentage);
    const performance  = pct(student.performanceScore);
    const completed    = isCompleted(student, taskPercent);
    const starStatus   = student.starStatus || "not_submitted";

    const measured = {
        attendancePercentage: attendance,
        performanceScore: performance,
        internshipCompleted: completed,
        taskCompletionPercent: taskPercent,
        starStatus
    };

    // ── LOC: completed internship AND attendance above 75% ──
    let loc;
    if (!completed && attendance <= THRESHOLDS.LOC_MIN_ATTENDANCE) {
        loc = { eligible: false, reason: `Finish your internship and reach above ${THRESHOLDS.LOC_MIN_ATTENDANCE}% attendance (currently ${attendance}%).` };
    } else if (!completed) {
        loc = { eligible: false, reason: `Available once your internship is complete (task journey ${taskPercent}% approved).` };
    } else if (attendance <= THRESHOLDS.LOC_MIN_ATTENDANCE) {
        loc = { eligible: false, reason: `Requires above ${THRESHOLDS.LOC_MIN_ATTENDANCE}% attendance — yours is ${attendance}%.` };
    } else {
        loc = { eligible: true, reason: `Internship complete with ${attendance}% attendance.` };
    }

    // ── LOR: performance above 70% ──
    const lor = performance > THRESHOLDS.LOR_MIN_PERFORMANCE
        ? { eligible: true, reason: `Performance ${performance}%.` }
        : { eligible: false, reason: `Requires above ${THRESHOLDS.LOR_MIN_PERFORMANCE}% performance — yours is ${performance}%.` };

    // ── STAR: HR has accepted the contribution ──
    let star;
    if (starStatus === "approved" || starStatus === "issued") {
        star = { eligible: true, reason: "Your contribution was accepted by HR." };
    } else if (starStatus === "pending_review") {
        star = { eligible: false, reason: "Your contribution is with HR for review." };
    } else if (starStatus === "rejected") {
        star = { eligible: false, reason: "Your contribution was not accepted. You may submit a new one." };
    } else {
        star = { eligible: false, reason: "Submit a contribution for review first." };
    }

    return { LOC: loc, LOR: lor, STAR: star, measured };
}

/** Evaluate a single type. Used by the apply and approve routes. */
async function evaluateOne(student, certificateType) {
    const all = await evaluate(student);
    const key = String(certificateType || "").toUpperCase();
    return all[key] || { eligible: false, reason: `Unknown certificate type: ${certificateType}` };
}

module.exports = { evaluate, evaluateOne, THRESHOLDS };
