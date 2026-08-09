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

  // Written-out numbers, so "one month" and "six months" parse.
  const WORD_NUMBERS = { one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', fifteen: '15', thirty: '30', fortyfive: '45', ninety: '90' };
  let normalized = t;
  for (const [word, digit] of Object.entries(WORD_NUMBERS)) {
    normalized = normalized.replace(new RegExp('^' + word), digit);
  }

  // Match a leading count followed by an optional unit, and NOTHING else.
  // Anchoring both ends matters: a loose substring test treats "unknown" as a
  // week, because the word contains a "w".
  const match = /^(\d+)(w|wk|wks|week|weeks|d|day|days|m|mo|mon|month|months|y|yr|year|years)?$/.exec(normalized);
  if (!match) return null;

  const count = Number.parseInt(match[1], 10);
  const unit = match[2] || '';

  if (/^(w|wk|wks|week|weeks)$/.test(unit)) {
    return count === 1 ? '1week' : null;
  }

  if (/^(m|mo|mon|month|months)$/.test(unit)) {
    if (count === 1) return '1month';
    if (count === 3) return '3months';
    if (count === 6) return '6months';
    return null;
  }

  if (/^(y|yr|year|years)$/.test(unit)) return null;   // no yearly tenure exists

  // A day count, or a bare number, maps to whichever tenure has that length.
  const byDays = { 7: '1week', 15: '15days', 30: '1month', 45: '45days', 90: '3months', 180: '6months' };
  if (byDays[count]) return byDays[count];

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
