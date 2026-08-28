'use strict';

/**
 * The two dates printed on a generated document, and who may change them.
 *
 * Every certificate, letter and offer funnels through buildCertPDF, which read
 * the dates like this:
 *
 *     startDate: student.startDate || student.joiningDate
 *     endDate:   student.endDate || student.completionDate || student.internshipEndDate
 *
 * `startDate`, `endDate` and `completionDate` are not fields on the Student
 * schema. They are always undefined, so the first expression was always
 * joiningDate and the second was always internshipEndDate — and three of the
 * five names in there described a fallback that could never fire.
 *
 * That mattered twice over:
 *
 *   - The admin portal's start-date control writes `internshipStartDate`.
 *     The PDF printed `joiningDate`. So HR could correct a student's start
 *     date, watch the portal update, and get a certificate with the old one.
 *     They are deliberately different values — a WhatsApp joiner's internship
 *     starts before their portal account exists — but the certificate is about
 *     the internship, so the internship's date is the one to print.
 *
 *   - internshipEndDate is null on a great many students, because it is only
 *     written by the paths that happen to set it. The PDF templates fall back
 *     to the literal string "End Date", so those students received a document
 *     with the words "End Date" printed where their end date should be. The
 *     end date is derivable from the start date and the tenure; deriving it is
 *     what those templates were reaching for.
 *
 * And on top of that: HR needs to be able to correct these two dates on the
 * document itself. A student who joined late, paused, or finished early has a
 * real start and end that no derivation can know. So an override is stored
 * PER DOCUMENT — a Letter of Completion and an Offer Letter describe different
 * spans and must not share one pair of dates — and only the dates. Nothing else
 * on a generated document is editable, because everything else is a fact the
 * portal measured.
 */

const { TENURE_DAYS } = require('../utils/tenure');

/** HR level 3 and above. Below that, issuing is allowed and editing is not. */
const DATE_EDIT_MIN_LEVEL = 3;

const TYPES = ['LOC', 'LOR', 'STAR', 'OFFER', 'LOP'];

function asDate(value) {
    if (!value) return null;
    const d = new Date(value);
    return isNaN(d.getTime()) ? null : d;
}

/**
 * The start of the internship, not the start of the portal account.
 *
 * internshipStartDate is what HR and the admin portal edit and what attendance
 * counts from. joiningDate is only the fallback for records that predate it.
 */
function derivedStart(student) {
    return asDate(student && student.internshipStartDate)
        || asDate(student && student.joiningDate);
}

/** The stored end date, or the one the tenure implies. */
function derivedEnd(student) {
    const stored = asDate(student && student.internshipEndDate);
    if (stored) return stored;

    const start = derivedStart(student);
    if (!start) return null;

    const tenure = (student && (student.tenure || student.v2DurationType)) || '';
    const days = TENURE_DAYS[tenure];
    if (!days) return null;          // an unknown tenure derives nothing

    const end = new Date(start.getTime());
    end.setDate(end.getDate() + days);
    return end;
}

/** The override HR stored for this one document type, if any. */
function overrideFor(student, certType) {
    const type = String(certType || '').toUpperCase();
    const all = student && student.certificateDates;
    if (!all) return null;
    // A Mongoose subdocument and a lean object are both plain enough to index.
    const row = typeof all.get === 'function' ? all.get(type) : all[type];
    if (!row) return null;
    return {
        start: asDate(row.start),
        end: asDate(row.end),
        setBy: row.setBy || '',
        setByLevel: row.setByLevel || null,
        at: asDate(row.at)
    };
}

/**
 * The dates to print, and where each came from.
 *
 * @returns {{start: Date|null, end: Date|null, source: {start: string, end: string},
 *            override: object|null}}
 */
function datesFor(student, certType) {
    const o = overrideFor(student, certType);
    const start = (o && o.start) || derivedStart(student);
    const end = (o && o.end) || derivedEnd(student);

    return {
        start,
        end,
        source: {
            start: o && o.start ? 'hr' : (student && student.internshipStartDate ? 'internship' : 'joining'),
            end: o && o.end ? 'hr' : (student && student.internshipEndDate ? 'stored' : 'derived')
        },
        override: o
    };
}

/**
 * Validate a proposed override before it is stored.
 *
 * Both dates are optional — HR may correct one and leave the other derived —
 * but an end before its start is always a mistake, and a date centuries away is
 * a typo rather than an intention.
 *
 * @returns {{ok: boolean, message?: string, start?: Date|null, end?: Date|null}}
 */
function validateOverride(input, student, certType) {
    const start = asDate(input && input.startDate);
    const end = asDate(input && input.endDate);

    if (input && input.startDate && !start) return { ok: false, message: 'That start date is not a date.' };
    if (input && input.endDate && !end) return { ok: false, message: 'That end date is not a date.' };
    if (!start && !end) return { ok: false, message: 'Nothing to change.' };

    const floor = new Date('2015-01-01');
    const ceiling = new Date(Date.now() + 10 * 365 * 24 * 3600 * 1000);
    for (const [label, d] of [['start', start], ['end', end]]) {
        if (d && (d < floor || d > ceiling)) {
            return { ok: false, message: `That ${label} date looks like a typo — check the year.` };
        }
    }

    // Compare against what will actually be printed: correcting only the start
    // must still not push it past an end date that stays derived.
    const current = datesFor(student, certType);
    const finalStart = start || current.start;
    const finalEnd = end || current.end;
    if (finalStart && finalEnd && finalEnd < finalStart) {
        return { ok: false, message: 'The end date is before the start date.' };
    }

    return { ok: true, start, end };
}

/** Can this session edit the dates? Issuing is a lower bar than rewriting. */
function mayEditDates(session) {
    const s = session || {};
    if (s.adminUser) return true;
    if (s.hr) return Number(s.hr.level || 1) >= DATE_EDIT_MIN_LEVEL;
    return false;
}

module.exports = {
    DATE_EDIT_MIN_LEVEL,
    TYPES,
    datesFor,
    derivedStart,
    derivedEnd,
    overrideFor,
    validateOverride,
    mayEditDates
};
