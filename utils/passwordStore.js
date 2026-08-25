'use strict';

/**
 * Set a student's password everywhere it is kept.
 *
 * A student's password lives in more than one document, and nothing until now
 * wrote to all of them:
 *
 *   EcosystemUser   what /login compares against when someone signs in with
 *                   their EMAIL — which is what the portal tells them to do
 *   Student         what the legacy employee-ID path compares against, and
 *                   there can be TWO of these rows for one person, because a
 *                   student may enrol in two domains on one email and the two
 *                   rows deliberately share a password
 *
 * Every password-writing path — the forgot-password reset, the admin reset,
 * the student's own change — updated only the Student row it happened to be
 * holding. So a reset appeared to succeed and the next sign-in still checked
 * the old hash, which is the "I reset my password and now I cannot log in"
 * report. With 790 students told to use Forgot Password, that is everyone.
 *
 * One function, so a future fourth path cannot get this wrong either.
 *
 * @param {string} email    the address that identifies the person
 * @param {string} plain    the new password, in cleartext
 * @returns {Promise<{hash: string, students: number, ecosystemUsers: number}>}
 */
async function setStudentPassword(email, plain) {
    const bcrypt = require('bcryptjs');
    const Student = require('../models/Student');
    const EcosystemUser = require('../models/EcosystemUser');

    const addr = String(email || '').trim().toLowerCase();
    if (!addr) throw new Error('setStudentPassword needs an email');
    if (!plain) throw new Error('setStudentPassword needs a password');

    const hash = await bcrypt.hash(plain, 12);

    /* updateMany, not findOne().save(): the two-domain case is exactly where a
       single-document write leaves half the account on the old password.
       Case-insensitive, because rows created before emails were stored
       lowercased hold "Name@Gmail.com" and an exact match misses them. */
    const rx = new RegExp('^' + addr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$', 'i');

    const [s, e] = await Promise.all([
        Student.updateMany({ email: rx }, {
            $set: { password: hash },
            $unset: { passwordResetToken: '', passwordResetExpiry: '' }
        }),
        EcosystemUser.updateMany({ email: rx }, { $set: { password: hash } })
    ]);

    const students = (s && (s.modifiedCount ?? s.nModified)) || 0;
    const ecosystemUsers = (e && (e.modifiedCount ?? e.nModified)) || 0;

    // Worth a line: a reset that updated nothing is the failure this exists to
    // stop, and it is otherwise indistinguishable from a successful one.
    if (!students && !ecosystemUsers) {
        console.warn(`[password] setStudentPassword matched no account for ${addr}`);
    } else {
        console.log(`[password] updated ${addr}: ${students} student row(s), ${ecosystemUsers} ecosystem user(s)`);
    }
    return { hash, students, ecosystemUsers };
}

module.exports = { setStudentPassword };
