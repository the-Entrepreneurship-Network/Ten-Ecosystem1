'use strict';

/**
 * Finding the account someone is trying to sign in to.
 *
 * A student who has been using the portal for weeks — marking attendance,
 * submitting tasks — would suddenly be told "Invalid Employee ID" or "Invalid
 * credentials". Their account was fine. The lookup was not.
 *
 * Three ways that happened, all of them in how the identifier was matched:
 *
 *   1. `Student.findOne({ employeeId: loginId })` is an EXACT, case-sensitive
 *      match. Employee IDs look like TEN/WEB/1005 and are typed by hand on a
 *      phone, where the keyboard lowercases, autocapitalises, or substitutes a
 *      similar-looking separator. "ten/web/1005" found nothing and the portal
 *      reported the account did not exist.
 *
 *   2. `Student.findOne({ email: loginId.toLowerCase() })` has the same
 *      problem in reverse: rows created before emails were stored lowercased
 *      hold "Name@Gmail.com", which an exact lowercase match never finds. The
 *      EcosystemUser branch of login was already fixed for this; the legacy
 *      Student branch beside it was not, so a student with no EcosystemUser
 *      record could not sign in by email at all.
 *
 *   3. The separator. Employee IDs are printed as TEN/WEB/1005 on the portal
 *      and appear as TEN-WEB-1005 in document numbers, so students type both.
 *
 * The rule here: an identifier identifies a person. Matching it should not
 * depend on which key their phone decided to send.
 *
 * Ordering matters for cost as well as correctness — the exact match runs
 * first and uses the unique index; the tolerant forms only run when that
 * misses, which is the rare case.
 */

/**
 * Compare two employee IDs as a human would.
 *
 * Case-insensitive, whitespace-stripped, and blind to which separator was used
 * between the parts. TEN/WEB/1005, ten-web-1005 and "TEN WEB 1005" are one ID.
 */
function normalizeEmployeeId(value) {
  return String(value == null ? '' : value)
    .trim()
    .toUpperCase()
    // Every run of slash, dash, underscore, dot or whitespace becomes one
    // separator, so the comparison ignores which one was typed.
    .replace(/[\s/\\_.-]+/g, '/')
    .replace(/^\/+|\/+$/g, '');
}

/** A regex that matches one exact string, case-insensitively. */
function exactInsensitiveRegex(value) {
  const escaped = String(value == null ? '' : value)
    .trim()
    .replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
  return new RegExp('^\\s*' + escaped + '\\s*$', 'i');
}

/** Does this look like an email address rather than an employee ID? */
function looksLikeEmail(value) {
  return String(value || '').includes('@');
}

/**
 * Find a Student by employee ID, tolerating how it was typed.
 *
 * @param {Object} StudentModel  the Mongoose model
 * @param {string} loginId
 * @returns {Promise<Object|null>}
 */
async function findStudentByEmployeeId(StudentModel, loginId) {
  const raw = String(loginId || '').trim();
  if (!raw) return null;

  // 1. Exactly as typed. Hits the unique index, and is what almost every
  //    successful sign-in takes.
  const exact = await StudentModel.findOne({ employeeId: raw });
  if (exact) return exact;

  // 2. Same characters, different case or padding.
  const insensitive = await StudentModel.findOne({ employeeId: exactInsensitiveRegex(raw) });
  if (insensitive) return insensitive;

  // 3. Different separator. Build a pattern that accepts any of them between
  //    the parts, rather than scanning the collection in application code.
  const parts = normalizeEmployeeId(raw).split('/').filter(Boolean);
  if (parts.length > 1) {
    const escapedParts = parts.map(p => p.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&'));
    const pattern = new RegExp('^\\s*' + escapedParts.join('[\\s/\\\\_.-]+') + '\\s*$', 'i');
    const loose = await StudentModel.findOne({ employeeId: pattern });
    if (loose) return loose;
  }

  return null;
}

/**
 * Find a Student by email, case-insensitively.
 *
 * Deliberately returns the record with the EARLIEST creation date when a
 * student holds more than one — the dual-domain case. Both rows share a
 * password, and the first is the one their linkedDomains were built around, so
 * the choice is at least stable between sign-ins rather than whichever the
 * database happened to return first.
 */
async function findStudentByEmail(StudentModel, loginId) {
  const raw = String(loginId || '').trim();
  if (!raw) return null;

  const exact = await StudentModel.findOne({ email: raw.toLowerCase() });
  if (exact) return exact;

  const matches = await StudentModel.find({ email: exactInsensitiveRegex(raw) })
    .sort({ createdAt: 1 })
    .limit(2);
  return matches[0] || null;
}

/**
 * Should this failed attempt count towards a lockout?
 *
 * `failedLoginAttempts` had no decay: it only ever reset on a successful sign-in
 * or when a lockout expired. So five mistyped passwords spread across three
 * months added up to a lockout, and the student — who had signed in wrong twice
 * in June and three times in August — was told their account was locked with no
 * idea why. The counter is meant to catch a burst of guesses, not a year of
 * ordinary human error.
 *
 * Anything older than the window starts a fresh count.
 *
 * @param {Object} user  the account record
 * @param {number} windowMs
 * @returns {number} the attempt number this failure represents
 */
function nextFailedAttemptCount(user, windowMs) {
  const previous = Number(user && user.failedLoginAttempts) || 0;
  const lastAt = user && user.lastFailedLoginAt ? new Date(user.lastFailedLoginAt).getTime() : 0;

  if (!previous) return 1;
  if (!lastAt || Number.isNaN(lastAt)) return previous + 1;
  if (Date.now() - lastAt > windowMs) return 1;   // the old run has expired
  return previous + 1;
}

module.exports = {
  normalizeEmployeeId,
  exactInsensitiveRegex,
  looksLikeEmail,
  findStudentByEmployeeId,
  findStudentByEmail,
  nextFailedAttemptCount
};
