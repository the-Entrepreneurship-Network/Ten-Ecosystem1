#!/usr/bin/env node
'use strict';

/**
 * Is email actually working on this server?
 *
 * The portal answers that question badly on its own: a misconfigured mailer
 * logs a line nobody reads and every send silently does nothing. This asks
 * three questions in order and stops at the first one that fails, so the
 * answer is a specific fix rather than "email is broken".
 *
 *   1. Are credentials present, and which variables did they come from?
 *   2. Does the SMTP server accept them?  (transporter.verify)
 *   3. Does a real message get through?   (--to you@example.com)
 *
 *   node scripts/check-email.js
 *   node scripts/check-email.js --to you@example.com
 *
 * Sends nothing unless --to is given.
 */

require('dotenv').config();
const { createEmailTransporter, smtpCredentials, mailerReady, EMAIL_FROM } = require('../utils/mailer');

const args = process.argv.slice(2);
const TO = (() => { const i = args.indexOf('--to'); return i === -1 ? null : args[i + 1]; })();

const ok = (m) => console.log('  \x1b[32m✓\x1b[0m ' + m);
const bad = (m) => console.log('  \x1b[31m✗\x1b[0m ' + m);
const row = (k, v) => console.log('  ' + String(k).padEnd(22) + v);

/** Which env var a value actually came from — the whole point when four are accepted. */
function sourceOf(names) {
    for (const n of names) if ((process.env[n] || '').trim()) return n;
    return null;
}

async function main() {
    console.log('\n1. Credentials\n' + '='.repeat(50));

    const userVar = sourceOf(['SMTP_USER', 'SES_SMTP_USER', 'EMAIL_USER', 'EMAIL_US']);
    const passVar = sourceOf(['SMTP_PASS', 'SES_SMTP_PASS', 'EMAIL_PASS']);
    const { user, host, port } = smtpCredentials();

    if (!mailerReady()) {
        bad('No SMTP credentials found.');
        console.log('\n  Set these in the .env file of THIS deployment directory,');
        console.log('  then run:  pm2 restart <app name> --update-env\n');
        console.log('    SMTP_HOST=<your provider\'s smtp host>');
        console.log('    SMTP_PORT=587');
        console.log('    SMTP_USER=<username your provider gave you>');
        console.log('    SMTP_PASS=<password / API key your provider gave you>');
        console.log('    EMAIL_FROM=TEN <no-reply@entrepreneurshipnetwork.net>\n');
        console.log('  EMAIL_FROM must be an address on a domain you have verified');
        console.log('  with the provider, or every message will be rejected.\n');
        process.exitCode = 1;
        return;
    }

    ok('Credentials present.');
    row('username from', userVar);
    row('password from', passVar);
    row('username', user);
    row('host', host);
    row('port', port);
    row('From address', EMAIL_FROM);

    // The From domain is what SPF/DKIM are published against. A mismatch here
    // is the single most common cause of "it says sent but nothing arrives".
    const fromDomain = (EMAIL_FROM.match(/@([^\s>]+)/) || [])[1];
    const userDomain = (String(user).match(/@(.+)$/) || [])[1];
    if (fromDomain && userDomain && fromDomain !== userDomain) {
        console.log('');
        console.log(`  Note: From is @${fromDomain} but the SMTP user is @${userDomain}.`);
        console.log('  That is normal for a relay (Brevo, SES, Resend) as long as');
        console.log(`  @${fromDomain} is verified there. It is a rejection if it is not.`);
    }

    console.log('\n2. Does the SMTP server accept us?\n' + '='.repeat(50));
    const transporter = createEmailTransporter();
    try {
        await transporter.verify();
        ok('Connected and authenticated.');
    } catch (err) {
        bad('Rejected: ' + err.message);
        console.log('\n  Common causes:');
        console.log('    • wrong username/password — reissue the key at the provider');
        console.log('    • port 465 needs EMAIL_SECURE=true; 587 does not');
        console.log('    • EC2 blocks outbound port 25 by default — use 587 or 465');
        console.log('    • the security group has no outbound rule for that port\n');
        process.exitCode = 1;
        return;
    }

    if (!TO) {
        console.log('\n3. Real delivery\n' + '='.repeat(50));
        console.log('  Skipped. Re-run with  --to you@example.com  to send one test message.\n');
        return;
    }

    console.log('\n3. Real delivery\n' + '='.repeat(50));
    try {
        const info = await transporter.sendMail({
            from: EMAIL_FROM,
            to: TO,
            subject: 'TEN portal — email check',
            text: `Sent by scripts/check-email.js from ${host}:${port} as ${user}.`
        });
        ok(`Accepted for delivery to ${TO}`);
        if (info && info.messageId) row('message id', info.messageId);
        if (info && info.response) row('server said', info.response);
        console.log('\n  Accepted is not the same as delivered. Check the inbox, then the');
        console.log('  spam folder. If it landed in spam, the DNS records (SPF, DKIM,');
        console.log('  DMARC) for the From domain are what to look at next.\n');
    } catch (err) {
        bad('Send failed: ' + err.message);
        if (/(sender|from|verif|domain)/i.test(err.message)) {
            console.log('\n  That reads like a sender-identity rejection: the provider does not');
            console.log(`  recognise ${EMAIL_FROM}. Verify that domain with them, or set`);
            console.log('  EMAIL_FROM to an address that is already verified.\n');
        }
        process.exitCode = 1;
    }
}

main().catch((err) => { console.error('Failed:', err.message); process.exitCode = 1; });
