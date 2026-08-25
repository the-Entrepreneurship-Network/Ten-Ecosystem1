'use strict';

/**
 * The registration that actually runs must send a welcome email.
 *
 * public/register.html posts to /api/register-hub/register — this controller —
 * NOT the /register route in server.js. That route has sent a welcome email all
 * along, and the live form has never called it. So every account created
 * through the real form was made in silence: no email, no MailHistory row, no
 * log line, nothing to notice. 798 students registered that way and the
 * welcome-mail table had no row newer than the day SMTP was first configured.
 *
 * Every hunt for this failed because the evidence all pointed at code that was
 * never running: the send looked correct, the credentials were right, the
 * transport worked, and 908 other messages went out the same day.
 */

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '../..');
const controller = fs.readFileSync(path.join(root, 'controllers/registerHubController.js'), 'utf8');
const code = controller
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');

describe('the live registration path sends a welcome email', () => {
    it('is the endpoint the real form posts to', () => {
        // If this ever stops being true, the fix is in the wrong file again.
        const page = fs.readFileSync(path.join(root, 'public/register.html'), 'utf8');
        expect(page).toContain('/api/register-hub/register');
    });

    it('sends the mail before replying to the browser', () => {
        const sendAt = code.indexOf('await sendRegistrationWelcome(');
        const replyAt = code.indexOf('return res.status(201)');
        expect(sendAt).toBeGreaterThan(-1);
        expect(sendAt).toBeLessThan(replyAt);
    });

    it('records the attempt either way', () => {
        /*
         * The absence of a MailHistory row is what hid this: a path that never
         * runs and a path that runs and fails look identical when neither
         * writes anything.
         */
        const fn = code.slice(code.indexOf('async function sendRegistrationWelcome'));
        const body = fn.slice(0, fn.indexOf('\n}'));
        expect(body).toMatch(/MailHistory\.create/);
        expect(body).toMatch(/mailType: 'welcome'/);
        expect(body).toMatch(/status,/);
    });

    it('never fails the registration', () => {
        // An account that was created must not be reported as failed because
        // the confirmation could not be sent.
        const fn = code.slice(code.indexOf('async function sendRegistrationWelcome'));
        const body = fn.slice(0, fn.indexOf('\n}'));
        expect(body).toMatch(/catch \(err\)/);
        expect(body).not.toMatch(/throw /);
    });

    it('does not mail the password back', () => {
        /*
         * Unlike server.js's version, which exists to deliver a password it
         * generated, the person here chose their own and typed it twice.
         * Mailing it back would hand out a credential over plain SMTP for
         * nothing.
         */
        const fn = code.slice(code.indexOf('async function sendRegistrationWelcome'));
        const body = fn.slice(0, fn.indexOf('\n}'));
        expect(body).not.toMatch(/\bpassword\b\s*[:,]/);
        expect(body).not.toMatch(/hashedPassword/);
    });

    it('carries the identifiers a student needs to be found', () => {
        const fn = code.slice(code.indexOf('async function sendRegistrationWelcome'));
        const body = fn.slice(0, fn.indexOf('\n}'));
        expect(body).toMatch(/Employee ID/);
        expect(body).toMatch(/escapeHtml\(employeeId\)/);
    });

    it('captures those identifiers out of the student-only branch', () => {
        // They were scoped inside `if (role === STUDENT)` and invisible at the
        // point the mail is sent.
        expect(code).toMatch(/let studentEmployeeId = ''/);
        expect(code).toMatch(/studentEmployeeId = employeeId/);
        expect(code).toMatch(/studentDocId = legacyStudent && legacyStudent\._id/);
    });

    it('reuses the shared mailer rather than defining a second one', () => {
        expect(code).toMatch(/require\('\.\.\/utils\/mailer'\)/);
        expect(code).toMatch(/EMAIL_FROM/);
        expect(code).not.toMatch(/nodemailer\.createTransport/);
    });
});
