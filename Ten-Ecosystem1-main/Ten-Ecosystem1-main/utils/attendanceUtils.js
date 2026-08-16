// utils/attendanceUtils.js
// SINGLE SOURCE OF TRUTH for attendance calculation across the entire TEN platform.
// ALL other files must import from here — do not duplicate this logic anywhere else.
//
// Four competing implementations used to exist (this file plus three in
// server.js) and they disagreed on both inputs to the percentage:
//
//   - the denominator: full-tenure working days vs elapsed working days vs
//     full-tenure calendar days vs elapsed calendar days
//   - whether Sundays counted
//
// GET /attendance-stats/:employeeId ran two of them and merged the results, so
// a single response contradicted itself, and the dashboard computed a fifth
// number client-side. Everything now routes through this file.
//
// The rules, stated once:
//   1. Sunday is never a working day. It is excluded from the denominator and
//      is never shown as a day the student had to attend.
//   2. The denominator is the working days ELAPSED so far, capped at the end of
//      the tenure — not the whole tenure. A student on day 3 of 45 is measured
//      against 3 days, not 45.
//   3. The requirement is 75% of those elapsed working days.
//   4. A WhatsApp joiner attended before they had a portal account. Their
//      internshipStartDate precedes their registration, and the pre-portal
//      stretch is credited as attended, because no daily records can exist for
//      days before the student was in the system.

'use strict';

const { getTenureDays, toDurationType } = require('./tenure');

// Re-exported so existing `TENURE_DAYS` / `getTenureDays` importers keep working.
const { TENURE_DAYS } = require('./tenure');

const ATTENDANCE_THRESHOLD = 0.75;

/** Sunday is the one non-working day. Named because section 2 asks for it. */
function isSunday(date) {
  const d = date instanceof Date ? date : new Date(date);
  return d.getDay() === 0;
}

function startOfDay(value) {
  const d = new Date(value);
  d.setHours(0, 0, 0, 0);
  return d;
}

/** YYYY-MM-DD in local time — matches how Attendance.dateKey is written. */
function toDateKey(value) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Count working days (Mon–Sat) between two dates INCLUSIVE, never counting
 * past today.
 */
function countWorkingDays(startDate, endDate) {
  const start = startOfDay(startDate);
  const end = new Date(endDate);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return 0;

  const today = new Date();
  today.setHours(23, 59, 59, 999);

  // Never count days that have not happened yet.
  const effectiveEnd = end < today ? end : today;
  effectiveEnd.setHours(23, 59, 59, 999);

  if (start > effectiveEnd) return 0;

  let count = 0;
  const current = new Date(start);
  while (current <= effectiveEnd) {
    if (!isSunday(current)) count++;
    current.setDate(current.getDate() + 1);
  }
  return count;
}

/**
 * The date a student's internship actually began.
 *
 * For a WhatsApp joiner this is internshipStartDate, which is deliberately
 * earlier than the day they registered on the portal. For everyone else it is
 * the joining date. Falling back to the account creation date keeps older
 * records working.
 */
function getEffectiveStartDate(student) {
  if (!student) return null;

  const candidates = student.joinerType === 'whatsapp'
    ? [student.internshipStartDate, student.joiningDate, student.createdAt]
    : [student.joiningDate, student.internshipStartDate, student.createdAt];

  for (const candidate of candidates) {
    if (!candidate) continue;
    const d = new Date(candidate);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return null;
}

/**
 * The day the student began using the portal — the point from which day-by-day
 * attendance records can exist at all.
 */
function getPortalStartDate(student) {
  if (!student) return null;
  for (const candidate of [student.joiningDate, student.createdAt, student.internshipStartDate]) {
    if (!candidate) continue;
    const d = new Date(candidate);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return null;
}

/** Last day of the tenure, inclusive of the start date. */
function getTenureEndDate(startDate, tenure) {
  const start = startOfDay(startDate);
  if (Number.isNaN(start.getTime())) return null;
  const end = new Date(start);
  end.setDate(end.getDate() + getTenureDays(tenure) - 1);
  end.setHours(23, 59, 59, 999);
  return end;
}

/** Working days in the FULL tenure span (used for "of N days" displays). */
function getTotalWorkingDaysForTenure(internshipStartDate, tenure) {
  const start = startOfDay(internshipStartDate);
  const end = getTenureEndDate(start, tenure);
  if (!end) return 0;

  // Deliberately counts the whole span, including days still in the future —
  // this is a target, not progress. countWorkingDays() caps at today, so walk
  // the range directly.
  let count = 0;
  const current = new Date(start);
  while (current <= end) {
    if (!isSunday(current)) count++;
    current.setDate(current.getDate() + 1);
  }
  return count;
}

/** Working days elapsed so far, capped at the end of the tenure. */
function getElapsedWorkingDays(internshipStartDate, tenure) {
  const end = getTenureEndDate(internshipStartDate, tenure);
  if (!end) return 0;
  return countWorkingDays(internshipStartDate, end);
}

/**
 * How many working days a WhatsApp joiner completed before the portal existed
 * for them. Zero for everyone else.
 *
 * These days are credited as attended: there is no Attendance row for a day the
 * student had no account on, and penalising them for that is exactly the bug
 * section 2 describes. A coordinator can correct the figure by setting
 * Student.preportalAbsentDays.
 */
function getPreportalCreditedDays(student) {
  if (!student || student.joinerType !== 'whatsapp') return 0;

  const effectiveStart = getEffectiveStartDate(student);
  const portalStart = getPortalStartDate(student);
  if (!effectiveStart || !portalStart) return 0;

  const start = startOfDay(effectiveStart);
  const end = startOfDay(portalStart);
  if (start >= end) return 0;

  // Up to (not including) the portal start date — that day is tracked normally.
  const dayBefore = new Date(end);
  dayBefore.setDate(dayBefore.getDate() - 1);

  const credited = countWorkingDays(start, dayBefore);
  const adjustment = Number(student.preportalAbsentDays) || 0;
  return Math.max(0, credited - adjustment);
}

/**
 * Unique dates on which the student was present, from Attendance rows.
 * A day counts once whether it was marked by the student, the coordinator, or
 * both.
 */
function countPresentDays(attendanceRecords) {
  const presentDays = new Set();
  for (const record of attendanceRecords || []) {
    if (!record || record.status !== 'Present') continue;
    const key = record.dateKey || (record.date ? toDateKey(record.date) : null);
    if (key) presentDays.add(key);
  }
  return presentDays.size;
}

/**
 * The complete attendance picture for one student.
 *
 * @param {Array} attendanceRecords Attendance documents for this student
 * @param {Object} student          the Student document
 * @returns {{
 *   percentage: number, daysPresent: number, trackedDaysPresent: number,
 *   preportalCreditedDays: number, workingDaysElapsed: number,
 *   totalWorkingDays: number, totalCalendarDays: number, requiredDays: number,
 *   isEligible: boolean, stillNeeds: number, dayNumber: number,
 *   daysRemaining: number, startDate: Date|null, endDate: Date|null
 * }}
 */
function getAttendanceSummary(attendanceRecords, student) {
  const tenure = toDurationType(student && (student.tenure || student.v2DurationType));
  const startDate = getEffectiveStartDate(student);

  const empty = {
    percentage: 0, daysPresent: 0, trackedDaysPresent: 0, preportalCreditedDays: 0,
    workingDaysElapsed: 0, totalWorkingDays: 0, totalCalendarDays: getTenureDays(tenure),
    requiredDays: 0, isEligible: false, stillNeeds: 0,
    dayNumber: 0, daysRemaining: getTenureDays(tenure), startDate: null, endDate: null
  };
  if (!startDate) return empty;

  const endDate = getTenureEndDate(startDate, tenure);
  const totalWorkingDays = getTotalWorkingDaysForTenure(startDate, tenure);
  const workingDaysElapsed = getElapsedWorkingDays(startDate, tenure);

  const preportalCreditedDays = getPreportalCreditedDays(student);
  const trackedDaysPresent = countPresentDays(attendanceRecords);

  // Credited pre-portal days can never exceed the elapsed window they sit in.
  const daysPresent = Math.min(workingDaysElapsed, trackedDaysPresent + preportalCreditedDays);

  const requiredDays = Math.ceil(workingDaysElapsed * ATTENDANCE_THRESHOLD);
  const percentage = workingDaysElapsed > 0
    ? Math.min(100, Math.round((daysPresent / workingDaysElapsed) * 100))
    : 0;

  // Calendar-day progress, for "Day 12 of 45".
  const today = startOfDay(new Date());
  const msPerDay = 24 * 60 * 60 * 1000;
  const elapsedCalendarDays = Math.floor((today - startOfDay(startDate)) / msPerDay) + 1;
  const totalCalendarDays = getTenureDays(tenure);
  const dayNumber = Math.max(0, Math.min(totalCalendarDays, elapsedCalendarDays));

  return {
    percentage,
    daysPresent,
    trackedDaysPresent,
    preportalCreditedDays,
    workingDaysElapsed,
    totalWorkingDays,
    totalCalendarDays,
    requiredDays,
    isEligible: daysPresent >= requiredDays,
    stillNeeds: Math.max(0, requiredDays - daysPresent),
    dayNumber,
    daysRemaining: Math.max(0, totalCalendarDays - dayNumber),
    startDate,
    endDate
  };
}

/**
 * Build the attendance history rows for display, Sundays omitted entirely.
 *
 * The dashboard used to generate a contiguous every-calendar-day roster and
 * default any day with no record to "Absent", so Sundays rendered as red
 * Absent rows even though the percentage excluded them (Screenshot 3). Days
 * before the student joined the portal are marked as WhatsApp-credited rather
 * than absent.
 *
 * @returns {Array<{dateKey, date, self, coordinator, isPreportal}>} newest first
 */
function buildAttendanceHistory(attendanceRecords, student) {
  const startDate = getEffectiveStartDate(student);
  if (!startDate) return [];

  const byDate = {};
  for (const record of attendanceRecords || []) {
    if (!record) continue;
    const key = record.dateKey || (record.date ? toDateKey(record.date) : null);
    if (!key) continue;
    byDate[key] = byDate[key] || {};
    if (record.markedBy === 'self') byDate[key].self = record.status;
    else byDate[key].coordinator = record.status;
  }

  const tenure = toDurationType(student && (student.tenure || student.v2DurationType));
  const tenureEnd = getTenureEndDate(startDate, tenure);
  const today = new Date();
  today.setHours(23, 59, 59, 999);
  const end = tenureEnd && tenureEnd < today ? tenureEnd : today;

  const portalStart = getPortalStartDate(student);
  const portalStartKey = portalStart ? toDateKey(portalStart) : null;
  const isWhatsappJoiner = student && student.joinerType === 'whatsapp';

  const rows = [];
  const current = startOfDay(startDate);
  while (current <= end) {
    if (isSunday(current)) {          // never a day the student had to attend
      current.setDate(current.getDate() + 1);
      continue;
    }
    const key = toDateKey(current);
    const marks = byDate[key] || {};
    const isPreportal = !!(isWhatsappJoiner && portalStartKey && key < portalStartKey);

    rows.push({
      dateKey: key,
      date: new Date(current),
      self:        marks.self        || (isPreportal ? 'Present' : 'Absent'),
      coordinator: marks.coordinator || (isPreportal ? 'Present' : 'Absent'),
      isPreportal
    });
    current.setDate(current.getDate() + 1);
  }

  return rows.reverse(); // newest first, as the table displays
}

/**
 * Attendance percentage.
 *
 * Preferred form: calculateAttendancePercentage(records, student) → summary object.
 * The two older signatures are kept so existing call sites keep working.
 */
function calculateAttendancePercentage(attendanceRecordsOrStudent, studentOrStartDate, tenure) {
  if (Array.isArray(attendanceRecordsOrStudent)) {
    const records = attendanceRecordsOrStudent;

    // (records, student)
    if (studentOrStartDate && typeof studentOrStartDate === 'object' && !(studentOrStartDate instanceof Date)) {
      return getAttendanceSummary(records, studentOrStartDate);
    }
    // Legacy (records, startDate, tenure)
    return getAttendanceSummary(records, {
      joiningDate: studentOrStartDate,
      internshipStartDate: studentOrStartDate,
      tenure
    });
  }

  // Legacy (student, presentCount) → a bare number
  const student = attendanceRecordsOrStudent;
  const presentCount = Number(studentOrStartDate) || 0;
  if (!student) return 0;

  const startDate = getEffectiveStartDate(student);
  if (!startDate) return 0;
  const elapsed = getElapsedWorkingDays(startDate, student.tenure || student.v2DurationType || tenure);
  if (elapsed <= 0) return 0;
  return Math.min(100, Math.round((presentCount / elapsed) * 100));
}

/** Has this student met the 75% requirement? */
function has75PercentAttendance(attendanceRecordsOrStudent, studentOrStartDate, tenure) {
  const res = calculateAttendancePercentage(attendanceRecordsOrStudent, studentOrStartDate, tenure);
  if (typeof res === 'number') return res >= 75;
  return res.isEligible;
}

/** Recompute from the database and persist the result on the Student. */
async function recomputeAndSaveAttendance(StudentModel, AttendanceModel, employeeId) {
  try {
    const student = await StudentModel.findOne({ employeeId });
    if (!student) return 0;

    const records = await AttendanceModel.find({ employeeId });
    const summary = getAttendanceSummary(records, student);

    await StudentModel.updateOne(
      { employeeId },
      {
        $set: {
          attendancePercentage: summary.percentage,
          calculatedAttendance: summary.daysPresent,
          calculatedAttendancePercentage: summary.percentage,
          attendanceLastCalculated: new Date()
        }
      }
    );
    return summary.percentage;
  } catch (err) {
    console.error('[AttendanceUtils] recomputeAndSaveAttendance error:', err.message);
    return 0;
  }
}

module.exports = {
  ATTENDANCE_THRESHOLD,
  TENURE_DAYS,
  getTenureDays,
  isSunday,
  toDateKey,
  countWorkingDays,
  getEffectiveStartDate,
  getPortalStartDate,
  getTenureEndDate,
  getTotalWorkingDaysForTenure,
  getElapsedWorkingDays,
  getPreportalCreditedDays,
  countPresentDays,
  getAttendanceSummary,
  buildAttendanceHistory,
  calculateAttendancePercentage,
  has75PercentAttendance,
  recomputeAndSaveAttendance
};
