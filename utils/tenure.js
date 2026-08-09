// utils/tenure.js
// SINGLE SOURCE OF TRUTH for interpreting a student's internship length.
//
// Six copies of this mapping used to exist — utils/attendanceUtils.js,
// services/v2/taskEngine.js, two separate copies in server.js, and two more in
// front-end pages — and they disagreed.
//
// The most damaging disagreement: the registration form writes
// Student.tenure as "1 Month" / "45 Days" (spaced, title case), while the
// attendance lookup table was keyed "1month" / "45days". No registered
// student's tenure ever matched, so every lookup fell through to the 30-day
// default. That is why a 45-day student's portal showed 3-month behaviour and
// why attendance targets were wrong across the board.
//
// normalizeTenure() accepts every shape any of those copies produced.

'use strict';

/** Canonical duration keys, in ascending length. */
const DURATION_TYPES = ['1week', '15days', '1month', '45days', '3months', '6months'];

/** Canonical key → total calendar days. */
const TENURE_DAYS = {
  '1week':   7,
  '15days':  15,
  '1month':  30,
  '45days':  45,
  '3months': 90,
  '6months': 180
};

/** Canonical key → the label shown to students and printed on documents. */
const TENURE_LABELS = {
  '1week':   '1 Week',
  '15days':  '15 Days',
  '1month':  '1 Month',
  '45days':  '45 Days',
  '3months': '3 Months',
  '6months': '6 Months'
};

const DEFAULT_DURATION_TYPE = '1month';

/**
 * Normalise any tenure representation to a canonical duration key.
 *
 * Handles "1 Month", "1month", "1-month", "1M", "one month", "30 days",
 * "45 Days", "45", "6 Months", and the durationType values already stored in
 * Student.v2DurationType.
 *
 * @param {unknown} tenure
 * @returns {string|null} a canonical key, or null when unrecognised
 */
function normalizeTenure(tenure) {
  if (tenure == null) return null;

  const raw = String(tenure).toLowerCase().trim();
  if (!raw) return null;

  // Strip spaces, hyphens and underscores: "45 Days" and "45-days" → "45days".
  const t = raw.replace(/[\s\-_]+/g, '');
  if (!t) return null;

  // Exact canonical match first — the common case once data is clean.
  if (Object.prototype.hasOwnProperty.call(TENURE_DAYS, t)) return t;

  // Order matters: check the longer/more specific patterns before the shorter
  // ones, so "15days" is not mistaken for "1..." and "6months" is not caught by
  // a bare month test.
  if (/^(45|45days?|45d)$/.test(t) || t.includes('45')) return '45days';
  if (/(^|[^0-9])15(d|day|days)?([^0-9]|$)/.test(t) || t.startsWith('15')) return '15days';
  if (/^(6|6months?|6m|sixmonths?|halfyear)$/.test(t) || /(^|[^0-9])6(m|month|months)/.test(t)) return '6months';
  if (/^(3|3months?|3m|threemonths?|quarter)$/.test(t) || /(^|[^0-9])3(m|month|months)/.test(t)) return '3months';
  if (/^(1week|1w|7days?|7d|oneweek|week)$/.test(t) || /(^|[^0-9])1?(w|week)/.test(t)) return '1week';
  if (/^(1month|1m|30days?|30d|onemonth|month)$/.test(t) || /(^|[^0-9])1?(m|month)/.test(t)) return '1month';

  return null;
}

/**
 * Like normalizeTenure(), but always returns a usable key.
 * Use where a value is required; prefer normalizeTenure() where "unknown"
 * should be handled explicitly.
 */
function toDurationType(tenure, fallback = DEFAULT_DURATION_TYPE) {
  return normalizeTenure(tenure) || fallback;
}

/** Total calendar days for a tenure. Unrecognised input falls back to 1 month. */
function getTenureDays(tenure) {
  return TENURE_DAYS[toDurationType(tenure)];
}

/** Human label, e.g. "45 Days". */
function getTenureLabel(tenure) {
  return TENURE_LABELS[toDurationType(tenure)];
}

/** Is this a recognised tenure? */
function isValidTenure(tenure) {
  return normalizeTenure(tenure) !== null;
}

/**
 * The last day of the internship, inclusive of the start date.
 * A 45-day internship starting 1 July ends 14 August, not 15 August.
 *
 * @param {Date|string} startDate
 * @param {unknown} tenure
 * @returns {Date|null}
 */
function getInternshipEndDate(startDate, tenure) {
  if (!startDate) return null;
  const start = new Date(startDate);
  if (Number.isNaN(start.getTime())) return null;

  const end = new Date(start);
  end.setDate(end.getDate() + getTenureDays(tenure) - 1);
  end.setHours(23, 59, 59, 999);
  return end;
}

module.exports = {
  DURATION_TYPES,
  TENURE_DAYS,
  TENURE_LABELS,
  DEFAULT_DURATION_TYPE,
  normalizeTenure,
  toDurationType,
  getTenureDays,
  getTenureLabel,
  isValidTenure,
  getInternshipEndDate
};
