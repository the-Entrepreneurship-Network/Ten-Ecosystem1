'use strict';

/**
 * What to call a student.
 *
 * This logic used to live inside models/Student.js, which means it could only
 * be loaded with a database driver present. It is pure string work and the
 * mail path needs it, so it lives here and Student.js re-exports it — every
 * existing caller is unchanged.
 */

/** Values that look like a name but are not one. */
const NOT_A_NAME = new Set(['undefined', 'null', 'nan', '-', '—']);

function isUsableName(value) {
    if (typeof value !== 'string') return false;
    const t = value.trim();
    return t.length > 0 && !NOT_A_NAME.has(t.toLowerCase());
}

/** Best available human name for a student, or "" when there is nothing. */
function deriveStudentName({ name, firstName, lastName, email } = {}) {
    if (isUsableName(name)) return name.trim();

    const parts = [firstName, lastName].filter(isUsableName).map((s) => s.trim());
    if (parts.length) return parts.join(' ');

    // Last resort: the email local part, tidied. "kanishka.sharma05" reads as
    // "Kanishka Sharma05" — imperfect, but identifiable, which is the point.
    if (typeof email === 'string' && email.includes('@')) {
        const local = email.split('@')[0].replace(/[._\-+]+/g, ' ').trim();
        if (local) return local.replace(/\b\w/g, (c) => c.toUpperCase());
    }
    return '';
}

/**
 * The name to open a marketing email with — or '' to open with no greeting.
 *
 * `deriveStudentName` is right for an admin table, where "Kdsharma21" beats a
 * blank cell because it identifies a row. A greeting is the opposite case:
 *
 *   "Dear Anita Rao,"    from anita.rao@   — reads as though we know her
 *   "Dear Kdsharma21,"   from kdsharma21@  — reads as though a script wrote it
 *
 * The second is worse than no greeting at all. A mail that opens straight on
 * its first sentence looks deliberate; one that greets a mangled mailbox name
 * looks like spam, and readers mark it as such — which costs the sending
 * domain far more than a missing "Dear".
 *
 * So a name RECOVERED FROM AN ADDRESS is used only when it reads like a human
 * name: at least two words, and no digits. A name the student actually gave us
 * is always used, whatever shape it is — that one is their choice, not a guess.
 */
function greetingNameFor(student = {}) {
    const given = [student.name, `${student.firstName || ''} ${student.lastName || ''}`.trim()]
        .find(isUsableName);
    if (given) return given.trim();

    const guessed = deriveStudentName({ email: student.email });
    // Two words from real separators, nothing numeric glued on.
    if (guessed && /\s/.test(guessed) && !/\d/.test(guessed)) return guessed;
    return '';
}

module.exports = { deriveStudentName, isUsableName, greetingNameFor, NOT_A_NAME };
