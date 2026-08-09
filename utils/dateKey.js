// utils/dateKey.js
// SINGLE SOURCE OF TRUTH for "which day is it?" across the platform.
//
// TEN operates in India, so a student's attendance day is an IST day. This was
// previously computed in two incompatible ways:
//
//   POST /mark-attendance          → now + 5:30, then take the ISO date
//   autoMarkCoordinatorAttendance  → new Date().toISOString().slice(0,10)  (UTC)
//
// The cron runs at 23:55 IST, which is 18:25 UTC the SAME day — but for any
// student marking attendance after 18:30 UTC the two produced different keys.
// Since Attendance has a unique index on {employeeId, dateKey, markedBy},
// disagreeing about the date silently creates or blocks the wrong row.

'use strict';

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/** The current instant shifted into IST. */
function istNow(now = new Date()) {
  return new Date(now.getTime() + IST_OFFSET_MS);
}

/**
 * The IST calendar day for an instant, as YYYY-MM-DD.
 * This is the value stored in Attendance.dateKey.
 */
function istDateKey(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return null;
  return new Date(d.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

/** Midnight UTC at the start of an IST day key — for range queries. */
function istDayStart(dateKey) {
  return new Date(`${dateKey}T00:00:00.000Z`);
}

/** Midnight UTC at the end of an IST day key. */
function istDayEnd(dateKey) {
  return new Date(`${dateKey}T23:59:59.999Z`);
}

module.exports = { IST_OFFSET_MS, istNow, istDateKey, istDayStart, istDayEnd };
