'use strict';

/**
 * "Access Denied – Invalid Employee ID", and nowhere to go from there (28 Nov).
 *
 * Students type the Employee ID they were sent: often one on a letter made by
 * hand in the HR portal (TEN/AM/…) or one from a WhatsApp list, which no portal
 * account has. Sign-in answered a bare "Invalid Employee ID", the help desk
 * repeated "use your Employee ID or email", and the student was stuck. Sign-in
 * now says why and what to do (sign in with the registered email, or
 * register), the pages offer both, and the help desk has the same answer.
 */

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '../..');
const SERVER = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const { match } = require('../../services/supportDesk/matcher');
const starters = require('../../services/supportDesk/starterAnswers');

describe('an Employee ID that no account has', () => {
    const login = SERVER.slice(SERVER.indexOf('app.post("/login"'));
    const miss = login.slice(login.indexOf('findStudentByEmployeeId(Student, loginId)'));

    it('is no longer the dead-end "Invalid Employee ID"', () => {
        expect(miss.slice(0, 800)).not.toContain('message: "Invalid Employee ID"');
        expect(miss.slice(0, 800)).toContain("unknownEmployeeId: true, registerUrl: '/register'");
    });

    it('tells the student to sign in with their email or register', () => {
        const msg = /const UNKNOWN_EMPLOYEE_ID_MESSAGE =([\s\S]*?);\n/.exec(SERVER);
        expect(msg).not.toBeNull();
        expect(msg[1]).toMatch(/email address you registered with/);
        expect(msg[1]).toMatch(/Register first/);
    });

    it.each(['public/login.html', 'public/student-login.html'])('%s offers both ways out', (page) => {
        const src = fs.readFileSync(path.join(root, page), 'utf8');
        const block = src.slice(src.indexOf('if (data.unknownEmployeeId)'));
        expect(src).toContain('if (data.unknownEmployeeId)');
        expect(block.slice(0, 900)).toContain('Sign in with email');
        expect(block.slice(0, 900)).toContain('window.location.href = data.registerUrl || "/register"');
    });

    it.each([
        'I am trying to sign in to the dashboard, but I am getting an error message saying "Access Denied – Invalid Employee ID."',
        'the employee id from my offer letter does not work for login'
    ])('the help desk answers "%s"', (text) => {
        const r = match(text, starters);
        expect(r.answers.length && r.answers[0].entry.key).toBe('invalid-employee-id');
    });
});
