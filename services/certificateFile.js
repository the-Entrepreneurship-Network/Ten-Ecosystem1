'use strict';

/**
 * Where a student's generated documents live on disk.
 *
 * Every certificate has always been written twice: once as a PDF under
 * uploads/, and once more as a base64 string on the Student document itself.
 * The second copy is what made a single student record megabytes long — the
 * reason models/Student.js has to carry sort indexes to keep the HR lists from
 * blowing the 100MB in-memory sort limit. It was never the only copy of
 * anything, so it is going away, and this module is the one place that knows
 * where the remaining copy is.
 *
 * Everything here is deliberately derived rather than stored. The filename has
 * always been a pure function of the employee ID and the document type, so
 * there is no new column to add, no lookup to keep in step, and nothing that
 * can drift out of sync with the files actually on disk.
 */

const fs = require('fs');
const path = require('path');

const UPLOADS = path.join(__dirname, '..', 'uploads');

const TYPES = ['LOC', 'LOR', 'STAR', 'OFFER', 'LOP'];

/**
 * The status field that says a document has been generated, and the values
 * that mean yes.
 *
 * Status rather than a stat() call: sanitizeStudent runs on every student in
 * every HR list, and five existsSync calls per row is thousands of synchronous
 * stats on one request. Each of these fields is set in the same write that
 * produces the PDF, so it answers the same question for free.
 */
const STATUS = {
    LOC:   { field: 'locStatus',           issued: ['issued'] },
    LOR:   { field: 'lorStatus',           issued: ['issued'] },
    STAR:  { field: 'starStatus',          issued: ['issued'] },
    LOP:   { field: 'lopStatus',           issued: ['issued'] },
    // documents.js sets 'approved' when it generates the offer letter;
    // certificates.js sets 'issued'. Both mean the PDF was written.
    OFFER: { field: 'offerLetterStatus',   issued: ['approved', 'issued'] }
};

/*
 * The base64 column a type used to live in. These columns are no longer on the
 * Student schema — the backfill cleared them and models/Student.js dropped the
 * declarations — so on current data every read here is undefined. The map stays
 * for two things that still name the columns: scripts/migrate-cert-pdfs.js uses
 * it as the query key (a lean read still returns a raw column if an old backup
 * is ever restored), and isIssued / the download route keep it as a last-resort
 * fallback for exactly that case. Read-only; nothing writes these any more.
 */
const LEGACY_B64 = {
    LOC: 'locPdfBase64', LOR: 'lorPdfBase64', STAR: 'starPdfBase64',
    OFFER: 'offerPdfBase64', LOP: 'lopPdfBase64'
};

const normType = (t) => String(t || '').toUpperCase();

/**
 * An employee ID as a single safe path segment.
 *
 * IDs look like TEN/WEB/1234 and have always been written with the slashes
 * turned into dashes. The whitelist is what stops a malformed ID from walking
 * out of the uploads directory: it is applied after the replacement, so an ID
 * containing `..` or a NUL yields no path at all rather than a surprising one.
 */
function slug(student) {
    const raw = String((student && (student.employeeId || student._id)) || '').replace(/\//g, '-');
    // A space is allowed. Real employee IDs carry the full domain name —
    // TEN/WEB DEVELOPMENT/1001 — and the ID IS the filename, not a URL
    // segment. A space cannot climb a directory; the only traversal moves are
    // `..` and the separator, and both are still refused (the slash is turned
    // to a dash above, `..` is blocked below, and `\`, NUL and control
    // characters fall outside the class). An earlier version rejected the
    // space too, which gave every full-name student no path at all: their
    // certificates could not be written, and the backfill could not place
    // them.
    return /^[A-Za-z0-9 ._-]+$/.test(raw) && !raw.includes('..') ? raw : '';
}

/** Where a newly generated PDF of this type is written. Null if the ID is unusable. */
function pathFor(student, type) {
    type = normType(type);
    if (!TYPES.includes(type)) return null;
    const id = slug(student);
    if (!id) return null;
    return type === 'OFFER'
        ? path.join(UPLOADS, 'offer-letters', `${id}_offer_letter.pdf`)
        : path.join(UPLOADS, 'certificates', `${id}_${type.toLowerCase()}.pdf`);
}

/**
 * Every place a PDF of this type might already be sitting, newest convention
 * first.
 *
 * LOC has two: routes/v2/certificates.js has always written
 * uploads/certificates/<employeeId>_loc.pdf, while the auto-generate path in
 * routes/v2/documents.js wrote uploads/loc/<_id>_loc.pdf — a different
 * directory keyed by a different field. Both are real files belonging to real
 * students, so both are searched rather than one of them being declared wrong.
 */
function candidates(student, type) {
    type = normType(type);
    const out = [];
    const primary = pathFor(student, type);
    if (primary) out.push(primary);
    if (type === 'LOC' && student && student._id) {
        const id = String(student._id);
        if (/^[A-Za-z0-9._-]+$/.test(id)) out.push(path.join(UPLOADS, 'loc', `${id}_loc.pdf`));
    }
    return out;
}

/** The path of an existing PDF of this type, or null. */
function findFor(student, type) {
    for (const p of candidates(student, type)) {
        try { if (fs.existsSync(p)) return p; } catch (_) { /* unreadable is missing */ }
    }
    return null;
}

/**
 * Has this document been generated?
 *
 * Reads the status field, and falls back to the legacy base64 column so that a
 * record the backfill has not reached yet still reports correctly. The fallback
 * is a presence test on a field the callers already hold; it does not pull the
 * blob.
 */
function isIssued(student, type) {
    if (!student) return false;
    type = normType(type);
    const spec = STATUS[type];
    if (!spec) return false;
    if (spec.issued.includes(student[spec.field])) return true;
    return !!student[LEGACY_B64[type]];
}

/** Write a generated PDF, creating its directory. Returns the path, or null. */
function save(student, type, buffer) {
    const target = pathFor(student, type);
    if (!target || !buffer || !buffer.length) return null;
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, buffer);
    return target;
}

/** Read a generated PDF from wherever it is. Returns a Buffer, or null. */
function read(student, type) {
    const found = findFor(student, type);
    if (!found) return null;
    try { return fs.readFileSync(found); } catch (_) { return null; }
}

/**
 * Delete every copy of a document.
 *
 * Used when HR revokes an override-issued certificate. Before this the revoke
 * cleared the base64 column and left the PDF on disk, which did not matter
 * while the column was what downloads read — and matters now, because the file
 * is the only copy and would keep serving a revoked document.
 */
function remove(student, type) {
    let removed = 0;
    for (const p of candidates(student, type)) {
        try { if (fs.existsSync(p)) { fs.unlinkSync(p); removed++; } } catch (_) { /* best effort */ }
    }
    return removed;
}

module.exports = { TYPES, STATUS, LEGACY_B64, pathFor, candidates, findFor, isIssued, save, read, remove, UPLOADS };
