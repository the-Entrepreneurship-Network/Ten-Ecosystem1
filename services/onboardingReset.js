'use strict';

/**
 * Send one student back through the joiner wizard.
 *
 * The wizard asks a question with consequences — "new joiner" or "WhatsApp
 * joiner" — and shows once. A student who answers wrong cannot undo it: the
 * WhatsApp answer back-dates their internship start and credits every day
 * between that date and their portal registration as attended, because no
 * daily records can exist for days before they were in the system. So a
 * mistaken tap hands out attendance nobody earned, and the student has no way
 * back.
 *
 * This is the way back, and HR holds it.
 *
 * WHAT IT TOUCHES, and nothing else:
 *
 *   the four onboarding flags     so the wizard opens once more
 *   joinerType                    the answer being withdrawn
 *   internshipStartDate           back to the portal registration date, which
 *                                 removes the pre-portal credit the wrong
 *                                 answer created
 *   calculatedAttendance          recounted from the records that really exist
 *
 * WHAT IT MUST NEVER TOUCH: tasks, submissions, coins, certificates,
 * documents, the Attendance rows themselves, or the employee id. A student who
 * has done a month of work keeps every bit of it — only the answer to one
 * question is withdrawn. The employee id is deliberately left alone even
 * though the wizard can change it: Attendance rows are keyed to it, and
 * reverting it here would orphan them.
 */

const Student = require('../models/Student');

/** The day this student's portal account began — the honest start line. */
function portalRegistrationDate(student) {
    if (student.joiningDate) {
        const d = new Date(student.joiningDate);
        if (!isNaN(d.getTime())) return d;
    }
    return student.createdAt ? new Date(student.createdAt) : new Date();
}

/**
 * @param {object} student  a Student document or lean object
 * @param {{by: string, byLevel: number, reason: string}} who  the HR doing it
 * @returns {Promise<{ok: boolean, student?: object, message?: string}>}
 */
async function resetOnboarding(student, who = {}) {
    if (!student || !student._id) return { ok: false, message: 'No such student.' };

    const previous = {
        joinerType: student.joinerType || null,
        internshipStartDate: student.internshipStartDate || null,
        calculatedAttendance: (student.calculatedAttendance == null ? null : student.calculatedAttendance)
    };

    const updates = {
        // The wizard opens again, once.
        onboardingPopupSeen: false,
        hasSeenOnboarding: false,
        joinerTypeSelected: false,
        joinerType: null,
        v2Onboarded: false,
        // The welcome card runs ahead of the wizard, so it has to come back too
        // or the wizard is reached by a path the student never sees.
        hasSeenWelcome: false,
        // The pre-portal credit goes with the answer that created it.
        internshipStartDate: portalRegistrationDate(student)
    };

    /*
     * Recount from what is actually recorded. Leaving the old figure would keep
     * the unearned days on the profile until the student happened to redo the
     * wizard — which is exactly the state HR is trying to get out of.
     */
    try {
        const Attendance = require('../models/Attendance');
        const { getAttendanceSummary } = require('../utils/attendanceUtils');
        const rows = await Attendance.find({ employeeId: student.employeeId });
        const summary = getAttendanceSummary(rows, Object.assign(
            student.toObject ? student.toObject() : { ...student },
            updates,
            { joinerType: null }          // no pre-portal credit any more
        ));
        updates.calculatedAttendance = summary.daysPresent;
        updates.calculatedAttendancePercentage = summary.percentage;
        updates.attendancePercentage = summary.percentage;
        updates.attendanceLastCalculated = new Date();
    } catch (err) {
        // A recount that cannot run must not block the reset — the wizard
        // reopening is the part the student is waiting on, and redoing it
        // recalculates anyway.
        console.error('[onboardingReset] recount failed:', err.message);
    }

    const updated = await Student.findOneAndUpdate(
        { _id: student._id },
        {
            $set: updates,
            $push: {
                onboardingResets: {
                    at: new Date(),
                    by: String(who.by || 'HR').slice(0, 120),
                    byLevel: who.byLevel || null,
                    reason: String(who.reason || '').slice(0, 500),
                    previous
                }
            }
        },
        { new: true }
    );
    if (!updated) return { ok: false, message: 'No such student.' };

    return { ok: true, student: updated, previous };
}

module.exports = { resetOnboarding, portalRegistrationDate };
