'use strict';

/**
 * The one-off mail to the 790 students who never got a welcome email.
 *
 * Not one of those mails ever succeeded: the early attempts died on "Missing
 * credentials for PLAIN" before SMTP existed, and after that the send was
 * addressed From a gmail.com address the relay refused. Nobody was told their
 * Employee ID or their password.
 *
 * Two things about this script would be silent and expensive if they broke,
 * so they are pinned here rather than discovered at 790 recipients.
 */

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '../..');
const src = fs.readFileSync(path.join(root, 'scripts/send-account-recovery.js'), 'utf8');

/* The script explains itself at length, and every "this must not appear"
   assertion below would otherwise match the comment describing why it must not
   appear. These check the code. */
const code = src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');

describe('account recovery mail', () => {
    it('sends nothing without --send', () => {
        // A bulk run started by accident cannot be recalled.
        expect(src).toMatch(/const SEND = args\.includes\('--send'\)/);
        expect(src).toMatch(/if \(!SEND\)/);
        const guard = src.slice(src.indexOf('if (!SEND)'));
        expect(src).toContain('DRY RUN');
        // The dry-run branch returns before the transporter is ever built.
        expect(guard.indexOf('return;')).toBeLessThan(guard.indexOf('createEmailTransporter'));
    });

    it('links somewhere that exists', () => {
        /*
         * There is no public/forgot-password.html. The reset is a widget
         * (public/forgot-password.js) that the login page initialises, so a
         * link to forgot-password.html would have sent every one of the 790
         * to a 404 — and the email would have been worse than not sending it.
         */
        expect(code).not.toContain('forgot-password.html');
        expect(src).toMatch(/const RESET_URL = `\$\{PORTAL_URL\}\/student-login`/);
        const page = path.join(root, 'public/student-login.html');
        expect(fs.existsSync(page)).toBe(true);
        // And that page really does mount the reset widget.
        expect(fs.readFileSync(page, 'utf8')).toContain('forgot-password.js');
    });

    it('never mails the same person twice', () => {
        // Resumable by construction: a success is recorded, and anyone with a
        // recorded success — from this script or a welcome mail that worked —
        // is skipped on the next run.
        expect(src).toMatch(/mailType: \{ \$in: \[MAIL_TYPE, 'welcome'\] \}/);
        expect(src).toMatch(/status: 'sent'/);
        expect(src).toMatch(/if \(done\.has\(email\)\)/);
        // One message per inbox, not per domain registration.
        expect(src).toMatch(/if \(!key \|\| byEmail\.has\(key\)\) continue;/);
    });

    it('does not resend or reset passwords', () => {
        /*
         * Only the bcrypt hash is stored, so the original password cannot be
         * resent. Issuing new ones would lock out every student who already
         * fixed their own through Forgot Password.
         */
        expect(code).not.toMatch(/bcrypt/);
        expect(code).not.toMatch(/generateTempPassword/);
        expect(code).not.toMatch(/updateOne[\s\S]{0,120}password/);
    });

    it('paces itself and stops on a provider block', () => {
        // The domain was suspended once for sending a burst.
        const gap = Number(/const GAP_MS = (\d+)/.exec(src)[1]);
        expect(gap).toBeGreaterThanOrEqual(1000);
        expect(src).toMatch(/suspend\|rate\|limit\|quota\|blocked/);
        expect(src).toMatch(/break;/);
    });

    it('skips an address that cannot receive', () => {
        expect(src).toContain('isSendableAddress(email)');
    });
});
