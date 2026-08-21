'use strict';

/**
 * One definition of "can this server send email".
 *
 * There were three. utils/mailer.js accepted SMTP_USER / SES_SMTP_USER /
 * EMAIL_USER / EMAIL_US; server.js repeated that chain verbatim; and
 * routes/v2/certificates.js checked EMAIL_USER and EMAIL_PASS alone.
 *
 * On a production box configured with SMTP_USER/SMTP_PASS the first two were
 * happy and the third was not, so every certificate email was skipped —
 * "[Email] EMAIL_USER or EMAIL_PASS not set", hundreds of times — while every
 * other mail from the same process went out normally. Students had their
 * certificate in the portal, no email, and a DocumentHistory row saying it had
 * been sent.
 *
 * These fail if anyone re-derives the check instead of asking the mailer.
 */

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '../..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

const CALLERS = ['server.js', 'routes/v2/certificates.js', 'routes/v2/payment.js'];

describe('mailer credentials', () => {
    const mailer = require('../../utils/mailer');

    afterEach(() => {
        for (const k of ['SMTP_USER', 'SMTP_PASS', 'SES_SMTP_USER', 'SES_SMTP_PASS',
                         'EMAIL_USER', 'EMAIL_PASS', 'EMAIL_US']) delete process.env[k];
    });

    it('exports the readiness check so nobody has to write their own', () => {
        expect(typeof mailer.mailerReady).toBe('function');
        expect(typeof mailer.smtpCredentials).toBe('function');
    });

    it('is not ready with no credentials at all', () => {
        expect(mailer.mailerReady()).toBe(false);
    });

    it('is ready on SMTP_USER/SMTP_PASS — the pair production actually uses', () => {
        process.env.SMTP_USER = 'relay-user';
        process.env.SMTP_PASS = 'secret';
        expect(mailer.mailerReady()).toBe(true);
    });

    it('is ready on the SES and legacy EMAIL_ pairs too', () => {
        process.env.SES_SMTP_USER = 'ses-user';
        process.env.SES_SMTP_PASS = 'secret';
        expect(mailer.mailerReady()).toBe(true);
        delete process.env.SES_SMTP_USER;
        delete process.env.SES_SMTP_PASS;

        process.env.EMAIL_USER = 'legacy-user';
        process.env.EMAIL_PASS = 'secret';
        expect(mailer.mailerReady()).toBe(true);
    });

    it('needs both halves — a username with no password is not ready', () => {
        process.env.SMTP_USER = 'relay-user';
        expect(mailer.mailerReady()).toBe(false);
    });

    it('no caller decides for itself whether email is configured', () => {
        for (const file of CALLERS) {
            const src = read(file);
            // The exact shape of the bug: gating on EMAIL_USER/EMAIL_PASS alone.
            expect(src).not.toMatch(/!process\.env\.EMAIL_USER/);
            expect(src).not.toMatch(/!process\.env\.EMAIL_PASS/);
        }
    });

    it('no caller builds its own From address out of EMAIL_USER', () => {
        for (const file of CALLERS) {
            // EMAIL_FROM already falls back through SMTP_USER; reading EMAIL_USER
            // here is how "undefined" ended up in a From header.
            expect(read(file)).not.toMatch(/from:.*process\.env\.EMAIL_USER/);
        }
    });

    it('the certificate mailer asks mailerReady and sends from EMAIL_FROM', () => {
        const src = read('routes/v2/certificates.js');
        const fn = src.slice(src.indexOf('async function sendCertificateEmail'));
        const body = fn.slice(0, fn.indexOf('\n}'));
        expect(body).toContain('mailerReady()');
        expect(body).toContain('from:    EMAIL_FROM');
    });

    it('a failed certificate email is reported as failed, not simulated', () => {
        const src = read('routes/v2/certificates.js');
        const fn = src.slice(src.indexOf('async function sendCertificateEmail'));
        const body = fn.slice(0, fn.indexOf('\n}'));
        // It used to return { sent: true, simulated: true } from the catch, so
        // DocumentHistory recorded "sent" and the student was told the mail was
        // on its way. Nothing had been sent and nothing had been simulated.
        expect(body).not.toMatch(/simulated:\s*true/);
        expect(body).toMatch(/catch[\s\S]*return \{ sent: false/);
    });
});

/**
 * No send may name its own From address.
 *
 * The welcome email — the first thing a student ever receives — was sent from
 * a hardcoded "ten.internshipportal@gmail.com". A relay only sends From a
 * domain verified in ITS account, and gmail.com is not ours, so that From was
 * refused outright while every other mail from the same process went out. A
 * student would register, see "a welcome email has been sent to you" in the
 * portal, and receive nothing. The promotion email had the same address.
 *
 * EMAIL_FROM is the one definition and already falls back through SMTP_USER.
 */
describe('the From address is never hardcoded', () => {
    const FILES = ['server.js', 'routes/v2/certificates.js', 'routes/v2/payment.js',
                   'routes/v2/documents.js', 'services/automationCron.js',
                   'services/notificationEmail.js'];

    it.each(FILES)('%s names no literal sender address', (file) => {
        const src = read(file);
        // `from:` followed by a quoted string containing an @ — a literal address.
        const literal = src.match(/from:\s*['"`][^'"`]*@[^'"`]*['"`]/g) || [];
        expect(literal).toEqual([]);
    });

    it('no send goes out from a gmail.com address', () => {
        for (const file of FILES) {
            expect(read(file)).not.toContain('ten.internshipportal@gmail.com');
        }
    });

    it('a failed welcome mail is logged, not just recorded', () => {
        // A MailHistory row with status "failed" is not something anyone reads.
        const src = read('server.js');
        const at = src.indexOf('Welcome mail to');
        expect(at).toBeGreaterThan(-1);
        expect(src.slice(at - 500, at)).toContain('mailStatus = "failed"');
    });
});
