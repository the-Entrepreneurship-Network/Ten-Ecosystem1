'use strict';

/**
 * A reset must change the password everywhere it is kept.
 *
 * /login compares an EMAIL sign-in against EcosystemUser. Every
 * password-writing path wrote only the Student row it happened to be holding,
 * so a reset "succeeded" and the next sign-in still checked the old hash.
 *
 * That is the "I did forgot password and now I cannot log in" report — and
 * with 790 students told to use Forgot Password, it was aimed at everyone.
 */

const bcrypt = require('bcryptjs');
const Student = require('../../models/Student');
const EcosystemUser = require('../../models/EcosystemUser');
const { setStudentPassword } = require('../../utils/passwordStore');

describe('setStudentPassword', () => {
    let calls;
    beforeEach(() => {
        calls = { student: [], eco: [] };
        jest.spyOn(Student, 'updateMany').mockImplementation((f, u) => {
            calls.student.push({ filter: f, update: u });
            return Promise.resolve({ modifiedCount: 2 });   // two-domain student
        });
        jest.spyOn(EcosystemUser, 'updateMany').mockImplementation((f, u) => {
            calls.eco.push({ filter: f, update: u });
            return Promise.resolve({ modifiedCount: 1 });
        });
    });
    afterEach(() => jest.restoreAllMocks());

    it('writes the SAME hash to both stores', async () => {
        const { hash } = await setStudentPassword('Ana@Example.org', 'a-new-password');
        expect(calls.student).toHaveLength(1);
        expect(calls.eco).toHaveLength(1);
        expect(calls.student[0].update.$set.password).toBe(hash);
        expect(calls.eco[0].update.$set.password).toBe(hash);
        // And it is a real bcrypt hash of what was asked for.
        expect(await bcrypt.compare('a-new-password', hash)).toBe(true);
    });

    it('updates EVERY student row for that email, not one', async () => {
        // A two-domain student has two rows sharing one password; a
        // findOne().save() leaves half the account on the old hash.
        const r = await setStudentPassword('two@domains.com', 'pw12345678');
        expect(r.students).toBe(2);
        expect(Student.updateMany).toHaveBeenCalled();
    });

    it('matches an address stored with different capitalisation', async () => {
        // Rows created before emails were lowercased hold "Name@Gmail.com".
        await setStudentPassword('Ana@Example.org', 'pw12345678');
        const rx = calls.student[0].filter.email;
        expect(rx).toBeInstanceOf(RegExp);
        expect(rx.test('ana@example.org')).toBe(true);
        expect(rx.test('ANA@EXAMPLE.ORG')).toBe(true);
        expect(rx.test('other@example.org')).toBe(false);
    });

    it('does not let a dot in the address match any character', async () => {
        await setStudentPassword('a.b@example.org', 'pw12345678');
        const rx = calls.student[0].filter.email;
        expect(rx.test('a.b@example.org')).toBe(true);
        expect(rx.test('axb@example.org')).toBe(false);
    });

    it('clears any outstanding reset token', async () => {
        // A link issued before this must stop working.
        await setStudentPassword('ana@example.org', 'pw12345678');
        expect(calls.student[0].update.$unset).toHaveProperty('passwordResetToken');
        expect(calls.student[0].update.$unset).toHaveProperty('passwordResetExpiry');
    });

    it('refuses to run without an email or a password', async () => {
        await expect(setStudentPassword('', 'pw')).rejects.toThrow(/email/);
        await expect(setStudentPassword('a@b.com', '')).rejects.toThrow(/password/);
    });
});

describe('every password-writing path uses it', () => {
    const fs = require('fs');
    const path = require('path');
    const root = path.join(__dirname, '../..');
    const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');

    it.each([
        ['server.js', 'the forgot-password reset'],
        ['routes/adminPortal.js', 'the admin reset'],
        ['routes/studentSecurity.js', "the student's own change"]
    ])('%s (%s)', (file) => {
        expect(read(file)).toMatch(/setStudentPassword/);
    });
});
