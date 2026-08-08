// utils/attendanceUtils.js
// SINGLE SOURCE OF TRUTH for attendance calculation across the entire TEN platform.
// ALL other files must import from here — do not duplicate this logic anywhere else.

'use strict';

// Authoritative tenure → calendar-day map
const TENURE_DAYS = {
  '1week':    7,
  '15days':   15,
  '1month':   30,
  '45days':   45,
  '3months':  90,
  '6months':  180
};

/**
 * Returns total calendar days for a given tenure string.
 * Falls back to 30 if tenure string is unrecognized.
 */
function getTenureDays(tenure) {
  return TENURE_DAYS[tenure] || 30;
}

/**
 * Count working days (Mon–Sat, excluding Sundays) between startDate and endDate INCLUSIVE.
 * Both parameters must be Date objects or ISO strings.
 * Does NOT go beyond today — if endDate is in the future, it's capped at today.
 */
function countWorkingDays(startDate, endDate) {
  const start = new Date(startDate);
  const end = new Date(endDate);
  const today = new Date();
  
  // Cap end date at today — never count future days as possible working days
  const effectiveEnd = end < today ? end : today;
  
  // Normalize to midnight to avoid timezone hour issues
  start.setHours(0, 0, 0, 0);
  effectiveEnd.setHours(23, 59, 59, 999);
  
  if (start > effectiveEnd) return 0;
  
  let count = 0;
  const current = new Date(start);
  while (current <= effectiveEnd) {
    if (current.getDay() !== 0) { // 0 = Sunday, exclude it
      count++;
    }
    current.setDate(current.getDate() + 1);
  }
  return count;
}
function toDateKey(date) {
  const dt = new Date(date);
  if (isNaN(dt.getTime())) return null;
  dt.setHours(0, 0, 0, 0);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

function isSunday(date) {
  const dt = new Date(date);
  return !isNaN(dt.getTime()) && dt.getDay() === 0;
}
/**
 * Get the total number of working days in the entire internship tenure
 * from internshipStartDate. This is the DENOMINATOR in the attendance % formula.
 * 
 * @param {Date|string} internshipStartDate - When the internship started
 * @param {string} tenure - e.g. "1month", "3months", "1week"
 * @returns {number} Total working days in the full tenure span
 */
function getTotalWorkingDaysForTenure(internshipStartDate, tenure) {
  const start = new Date(internshipStartDate);
  const calendarDays = getTenureDays(tenure);
  const end = new Date(start);
  end.setDate(start.getDate() + calendarDays - 1);
  return countWorkingDays(start, end);
}

/**
 * Get working days elapsed so far (from start to today, capped at tenure end).
 * This is useful for showing "days elapsed" in progress displays.
 * 
 * @param {Date|string} internshipStartDate
 * @param {string} tenure
 * @returns {number} Working days elapsed so far
 */
function getElapsedWorkingDays(internshipStartDate, tenure) {
  const start = new Date(internshipStartDate);
  const calendarDays = getTenureDays(tenure);
  const tenureEnd = new Date(start);
  tenureEnd.setDate(start.getDate() + calendarDays - 1);
  return countWorkingDays(start, tenureEnd);
}

/**
 * MAIN FUNCTION: Calculate attendance percentage.
 * 
 * FORMULA: (daysPresent / totalWorkingDaysInTenure) * 100
 * - daysPresent: unique calendar dates where student has ANY Attendance record with 
 *   status "Present" (either self or coordinator — whichever source, one day = one count)
 * - totalWorkingDays: ALL working days (Mon-Sat) in the FULL tenure span, 
 *   NOT just elapsed days — this is the company's denominator choice.
 * 
 * @param {Array|Object} attendanceRecordsOrStudent - Array of Attendance docs OR a student object if old signature
 * @param {Date|string|number} internshipStartDateOrPresentCount - Start date OR present count for backward compatibility
 * @param {string} tenure
 * @returns {{ percentage: number, daysPresent: number, totalWorkingDays: number, 
 *             requiredDays: number, isEligible: boolean, stillNeeds: number } | number}
 */
function calculateAttendancePercentage(attendanceRecordsOrStudent, internshipStartDateOrPresentCount, tenure) {
  // Support legacy signature: calculateAttendancePercentage(student, presentCount)
  if (Array.isArray(attendanceRecordsOrStudent)) {
    const attendanceRecords = attendanceRecordsOrStudent;
    const internshipStartDate = internshipStartDateOrPresentCount;
    const totalWorkingDays = getTotalWorkingDaysForTenure(internshipStartDate, tenure);
    const start = new Date(internshipStartDate);
    start.setHours(0, 0, 0, 0);
    
    // De-duplicate by date: status !== 'Absent' and ignore Sundays
    const presentDays = new Set();
    
    for (const record of attendanceRecords) {
      if (!record) continue;
      const recordDate = record.date ? new Date(record.date) : (record.dateKey ? new Date(record.dateKey) : null);
      if (!recordDate || isSunday(recordDate)) continue;
      recordDate.setHours(0, 0, 0, 0);
      if (recordDate < start) continue;
      if (record.status === 'Absent') continue;
      const key = toDateKey(recordDate);
      if (key) presentDays.add(key);
    }
    
    const daysPresent = presentDays.size;
    const requiredDays = Math.ceil(totalWorkingDays * 0.75);
    const percentage = totalWorkingDays > 0 
      ? Math.min(100, Math.round((daysPresent / totalWorkingDays) * 100)) 
      : 0;
    const isEligible = daysPresent >= requiredDays;
    const stillNeeds = Math.max(0, requiredDays - daysPresent);
    
    return {
      percentage,
      daysPresent,
      totalWorkingDays,
      requiredDays,
      isEligible,
      stillNeeds
    };
  } else {
    // Legacy fallback signature
    const student = attendanceRecordsOrStudent;
    const presentCount = Number(internshipStartDateOrPresentCount) || 0;
    if (!student) return 0;
    const startDate = student.internshipStartDate || student.joiningDate || new Date();
    const ten = student.tenure || student.v2DurationType || tenure || '1month';
    const totalWorkingDays = getTotalWorkingDaysForTenure(startDate, ten);
    if (totalWorkingDays <= 0) return 0;
    return Math.min(100, Math.round((presentCount / totalWorkingDays) * 100));
  }
}

/**
 * Simple boolean check: has this student met the 75% attendance requirement?
 */
function has75PercentAttendance(attendanceRecordsOrStudent, internshipStartDateOrPresentCount, tenure) {
  if (Array.isArray(attendanceRecordsOrStudent)) {
    const res = calculateAttendancePercentage(attendanceRecordsOrStudent, internshipStartDateOrPresentCount, tenure);
    return typeof res === 'object' ? res.isEligible : false;
  } else {
    const pct = calculateAttendancePercentage(attendanceRecordsOrStudent, internshipStartDateOrPresentCount, tenure);
    return (typeof pct === 'number' ? pct : pct.percentage) >= 75;
  }
}

/**
 * Recompute and return the attendance percentage for a student directly from DB.
 */
async function recomputeAndSaveAttendance(StudentModel, AttendanceModel, employeeId) {
  try {
    const student = await StudentModel.findOne({ employeeId });
    if (!student) return 0;
    
    const records = await AttendanceModel.find({ employeeId });
    const startDate = student.internshipStartDate || student.joiningDate || student.createdAt;
    const tenure = student.tenure || '1month';
    
    const result = calculateAttendancePercentage(records, startDate, tenure);
    const percentage = typeof result === 'object' ? result.percentage : result;
    const daysPresent = typeof result === 'object' ? result.daysPresent : 0;
    
    await StudentModel.updateOne(
      { employeeId },
      { 
        $set: { 
          attendancePercentage: percentage,
          calculatedAttendance: daysPresent,
          calculatedAttendancePercentage: percentage,
          attendanceLastCalculated: new Date()
        }
      }
    );
    
    return percentage;
  } catch (err) {
    console.error('[AttendanceUtils] recomputeAndSaveAttendance error:', err.message);
    return 0;
  }
}

module.exports = {
  TENURE_DAYS,
  getTenureDays,
  countWorkingDays,
  getTotalWorkingDaysForTenure,
  getElapsedWorkingDays,
  calculateAttendancePercentage,
  has75PercentAttendance,
  recomputeAndSaveAttendance
};

