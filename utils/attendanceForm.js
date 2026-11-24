'use strict';

/**
 * The daily attendance Google Form, filled in with what the portal already
 * knows about the student, so they only press Submit.
 *
 * FIELDS maps each detail to the form's own field id: the `entry.<number>` in
 * a link from the form editor's ⋮ → "Get pre-filled link". It is empty until
 * that link is supplied, and until then the form opens blank.
 */
const FORM = 'https://docs.google.com/forms/d/e/1FAIpQLSf3qZwNUgQl7vqqTnGW4PKrMDwRWPJEMiVQ-NUI6h4NnJa8Zg/viewform';

// e.g. { name: 'entry.1234567890', email: 'entry.…', employeeId: 'entry.…', domain: 'entry.…', college: 'entry.…', date: 'entry.…' }
const FIELDS = {};

/**
 * @param {object} student  a Student document or plain object
 * @param {string} dateKey  today as YYYY-MM-DD, the format a Google Forms date question pre-fills with
 */
function attendanceFormLink(student, dateKey, fields = FIELDS) {
    const s = student || {};
    const values = {
        name: s.name || [s.firstName, s.lastName].filter(Boolean).join(' '),
        email: s.email,
        employeeId: s.employeeId,
        domain: s.domain,
        college: s.collegeName || s.college,
        date: dateKey
    };
    const filled = Object.keys(fields)
        .filter((k) => values[k])
        .map((k) => `${fields[k]}=${encodeURIComponent(values[k])}`);
    return filled.length ? `${FORM}?usp=pp_url&${filled.join('&')}` : FORM;
}

module.exports = { attendanceFormLink, FORM };
