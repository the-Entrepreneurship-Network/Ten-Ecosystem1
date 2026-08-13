'use strict';

/**
 * Per-domain attendance scoping.
 *
 * A student may hold up to two domains, and the two are separate internships:
 * marking present in Web Development says nothing about Data Science. The
 * portal has to treat them independently on BOTH sides — one mark per domain
 * per day going in, and one count per domain coming out.
 *
 * Two things were in the way.
 *
 * 1. Two different dual-domain shapes exist in production.
 *
 *    - `POST /register` creates a SECOND Student document for the second
 *      domain and links the pair through `linkedDomains`. Each document has
 *      its own employeeId, so attendance separates naturally.
 *    - `POST /api/register-hub/register` — the path the live registration form
 *      actually posts to — creates ONE document with `domains: [a, b]` and a
 *      single employeeId. For those students the unique index
 *      `{employeeId, dateKey, markedBy}` allowed exactly one mark per day
 *      across BOTH domains: marking the first domain made the second
 *      impossible. That is the bug this module exists to fix, together with
 *      the widened index in models/Attendance.js.
 *
 * 2. Filtering was done in Mongo with an anchored regex on `domain`.
 *    `Attendance.domain` defaults to `""`, and rows written before the field
 *    was populated still carry that default, so an anchored match dropped them
 *    silently — the student's own history stopped counting. Filtering happens
 *    in JS here instead (a student has at most a few hundred rows), and a row
 *    with no domain is attributed to the student's primary domain rather than
 *    discarded.
 */

const { normalizeDomain } = require('../config/domains');

/**
 * The comparison key for a domain string.
 *
 * Canonical name where the value is recognised, otherwise a lowercased trim so
 * that "web development " and "Web Development" still meet. Unusable values
 * collapse to "" — the marker for "no domain recorded".
 */
function domainKey(value) {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (!trimmed) return '';
  return (normalizeDomain(trimmed) || trimmed).toLowerCase();
}

/**
 * Every domain this student is enrolled in, primary first, de-duplicated.
 *
 * Reads all three shapes the portal writes: `domains[]` (register-hub),
 * `linkedDomains[]` (the two-document form) and the plain `domain` string.
 */
function studentDomains(student) {
  if (!student) return [];

  const out = [];
  const seen = new Set();
  const push = (value) => {
    if (typeof value !== 'string') return;
    const trimmed = value.trim();
    if (!trimmed) return;
    const key = domainKey(trimmed);
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push(normalizeDomain(trimmed) || trimmed);
  };

  push(student.domain);
  if (Array.isArray(student.domains)) student.domains.forEach(push);
  if (Array.isArray(student.linkedDomains)) {
    student.linkedDomains.forEach((link) => {
      if (!link) return;
      push(typeof link === 'string' ? link : link.domain);
    });
  }

  return out;
}

/** The domain a row with no `domain` value belongs to. */
function primaryDomain(student) {
  const all = studentDomains(student);
  return all.length ? all[0] : '';
}

/** Is this student enrolled in more than one domain? */
function hasMultipleDomains(student) {
  return studentDomains(student).length > 1;
}

/**
 * Which domain a request is about.
 *
 * A requested domain is honoured only if the student is actually enrolled in
 * it — otherwise a client could scope someone else's domain onto this student
 * and read an empty history as though they had never attended. An
 * unrecognised or absent request falls back to the primary domain.
 *
 * @returns {string} a canonical domain name, or "" when the student has none
 */
function resolveActiveDomain(student, requested) {
  const enrolled = studentDomains(student);
  if (!enrolled.length) {
    // No enrolment on record: take the request at face value so a coordinator
    // marking an unusual account still lands somewhere sensible.
    return typeof requested === 'string' ? requested.trim() : '';
  }

  const wanted = domainKey(requested);
  if (wanted) {
    const match = enrolled.find((d) => domainKey(d) === wanted);
    if (match) return match;
  }
  return enrolled[0];
}

/**
 * Does this attendance row belong to `domain` for this student?
 *
 * A single-domain student always matches: every row they have is theirs, and
 * rejecting one because its stored label drifted would erase real attendance.
 */
function recordMatchesDomain(record, domain, student) {
  if (!record) return false;
  if (!hasMultipleDomains(student)) return true;

  const wanted = domainKey(domain);
  if (!wanted) return true;

  const stored = domainKey(record.domain);
  // Rows written before `domain` was populated belong to the primary domain,
  // which is where every historical write path put the student.
  if (!stored) return wanted === domainKey(primaryDomain(student));
  return stored === wanted;
}

/** The subset of `records` that belongs to `domain`. */
function filterByDomain(records, domain, student) {
  const list = Array.isArray(records) ? records : [];
  if (!hasMultipleDomains(student)) return list;
  return list.filter((r) => recordMatchesDomain(r, domain, student));
}

/**
 * The value to store on a new Attendance row.
 *
 * Always canonical, so the read side can compare keys without a regex.
 */
function domainForWrite(student, requested) {
  return resolveActiveDomain(student, requested) || '';
}

module.exports = {
  domainKey,
  studentDomains,
  primaryDomain,
  hasMultipleDomains,
  resolveActiveDomain,
  recordMatchesDomain,
  filterByDomain,
  domainForWrite
};
