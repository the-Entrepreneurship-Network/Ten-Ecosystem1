#!/usr/bin/env node
'use strict';

/**
 * Tell the students who never got a welcome email that their account exists.
 *
 * 790 students registered and not one welcome mail ever succeeded: the
 * earliest attempts died on "Missing credentials for PLAIN" before SMTP was
 * configured, and after that the send was addressed From a gmail.com address
 * the relay refused, so it stopped being attempted at all. Nobody was ever
 * told their Employee ID or their password.
 *
 * What this does NOT do is re-send those passwords, because they do not
 * exist. Only the bcrypt hash is stored — deliberately — and the cleartext
 * lived in one request's memory for the length of one email that never went
 * out. It is gone.
 *
 * Nor does it reset them. Some of these students already fixed their own
 * password through Forgot Password and use the portal daily; issuing 790 new
 * passwords would lock every one of them out to solve a problem they do not
 * have.
 *
 * So it sends the one thing that is both true and useful: your account is
 * here, this is your Employee ID, set a password with the link. Login accepts
 * the email address too (services/loginIdentity.js), so the ID is a
 * convenience rather than a requirement.
 *
 *   node scripts/send-account-recovery.js                  # dry run — prints, sends nothing
 *   node scripts/send-account-recovery.js --limit 20       # dry run, first 20
 *   node scripts/send-account-recovery.js --send --limit 20   # really send 20
 *   node scripts/send-account-recovery.js --send           # really send to everyone left
 *
 * Sends NOTHING without --send. Start with a small --limit, check the inbox,
 * then widen.
 *
 * Resumable: every success writes a MailHistory row with mailType
 * "account_recovery", and anyone who already has one is skipped. Stop it with
 * Ctrl-C and run it again; it picks up where it left off.
 */

require('dotenv').config();
const mongoose = require('mongoose');

const {
    createEmailTransporter, mailerReady, isSendableAddress,
    renderEmail, escapeHtml, PORTAL_URL, EMAIL_FROM
} = require('../utils/mailer');

const Student = require('../models/Student');
const MailHistory = require('../models/MailHistory');

const args = process.argv.slice(2);
const SEND = args.includes('--send');
const LIMIT = (() => {
    const i = args.indexOf('--limit');
    return i === -1 ? Infinity : Math.max(1, parseInt(args[i + 1], 10) || 1);
})();

/* One every two seconds. The domain was suspended once already for sending a
   burst, and it was reinstated days ago — 790 messages arriving as fast as the
   loop can push them is how that happens again. At this pace the whole run is
   about half an hour and looks like a person, not a script.
   ponytail: fixed delay, no backoff. If the provider starts deferring, stop
   the run and raise this rather than making it adaptive. */
const GAP_MS = 2000;

const MAIL_TYPE = 'account_recovery';
const SUBJECT = 'Your TEN internship account — set your password';

/*
 * The reset lives on the login page, not at a URL of its own.
 *
 * public/forgot-password.js is a widget that student-login.html initialises —
 * there is no forgot-password.html to link to, and pointing 790 people at one
 * would have sent every one of them to a 404.
 */
const RESET_URL = `${PORTAL_URL}/student-login`;

function body(student) {
    return renderEmail({
        heading: 'Your account is ready',
        name: student.name || student.fullName || 'there',
        bodyHtml: `
      <p>Your place on the ${escapeHtml(student.domain || 'TEN')} internship is set up and waiting
         for you. We are getting in touch because the original sign-in email
         never reached you — that was our fault, and it is fixed.</p>
      <p>You do not need your old password. Open the portal, choose
         <b>Forgot password</b> on the sign-in box, and enter this email
         address — you can sign in afterwards with either your email or the
         Employee ID shown here.</p>`,
        panel: `
      <div><b>Employee ID:</b> ${escapeHtml(student.employeeId || '—')}</div>
      <div><b>Domain:</b> ${escapeHtml(student.domain || '—')}</div>
      <div><b>Email:</b> ${escapeHtml(student.email)}</div>`,
        cta: { label: 'Open the portal and set my password', url: RESET_URL },
        note: 'If you already sign in to the portal without trouble, nothing has changed and you can ignore this.'
    });
}

async function main() {
    if (!process.env.MONGODB_URI) {
        console.error('MONGODB_URI is not set. Run this from the deployment directory.');
        process.exitCode = 1;
        return;
    }
    if (SEND && !mailerReady()) {
        console.error('SMTP credentials are not set — nothing would send. Check .env.');
        process.exitCode = 1;
        return;
    }

    await mongoose.connect(process.env.MONGODB_URI);

    // Anyone already told, by this script or by a welcome mail that worked.
    const done = new Set(
        (await MailHistory.find({
            mailType: { $in: [MAIL_TYPE, 'welcome'] },
            status: 'sent'
        }).distinct('recipientEmail')).map((e) => String(e).toLowerCase())
    );

    const students = await Student.find({})
        .select('name fullName email employeeId domain createdAt')
        .sort({ createdAt: 1 })
        .lean();

    // One message per person, not per domain registration: a student on two
    // tracks is one inbox and would otherwise get the same mail twice.
    const byEmail = new Map();
    for (const s of students) {
        const key = String(s.email || '').trim().toLowerCase();
        if (!key || byEmail.has(key)) continue;
        byEmail.set(key, s);
    }

    const queue = [];
    let skippedDone = 0, skippedBad = 0;
    for (const [email, s] of byEmail) {
        if (done.has(email)) { skippedDone++; continue; }
        if (!isSendableAddress(email)) { skippedBad++; continue; }
        queue.push({ ...s, email });
    }

    console.log(`students            ${students.length}`);
    console.log(`unique addresses    ${byEmail.size}`);
    console.log(`already told        ${skippedDone}`);
    console.log(`unsendable address  ${skippedBad}`);
    console.log(`to send             ${queue.length}`);
    const batch = queue.slice(0, LIMIT === Infinity ? queue.length : LIMIT);
    console.log(`this run            ${batch.length}${SEND ? '' : '  (DRY RUN — nothing will be sent)'}\n`);

    if (!batch.length) { await mongoose.disconnect(); return; }

    if (!SEND) {
        batch.slice(0, 10).forEach((s) => console.log(`  would send to ${s.email}  (${s.employeeId})`));
        if (batch.length > 10) console.log(`  … and ${batch.length - 10} more`);
        console.log('\nRe-run with --send to actually send. Start with --limit 20.\n');
        await mongoose.disconnect();
        return;
    }

    const transporter = createEmailTransporter();
    let sent = 0, failed = 0;

    for (const s of batch) {
        try {
            await transporter.sendMail({
                from: EMAIL_FROM,
                to: s.email,
                subject: SUBJECT,
                html: body(s),
                text: `Your TEN internship account is ready.\n\n`
                    + `Employee ID: ${s.employeeId || '-'}\nDomain: ${s.domain || '-'}\n\n`
                    + `Open ${RESET_URL} and choose "Forgot password".\n`
                    + `You can sign in with this email address or your Employee ID.`
            });
            sent++;
            console.log(`  OK   ${s.email}`);
            await MailHistory.create({
                recipientEmail: s.email, recipientName: s.name || '',
                studentId: s._id, subject: SUBJECT, mailType: MAIL_TYPE,
                sentAt: new Date(), status: 'sent'
            });
        } catch (err) {
            failed++;
            const reason = (err && err.message) || 'unknown';
            console.log(`  FAIL ${s.email} — ${reason}`);
            // Not recorded as sent, so the next run retries this one.
            try {
                await MailHistory.create({
                    recipientEmail: s.email, recipientName: s.name || '',
                    studentId: s._id, subject: SUBJECT, mailType: MAIL_TYPE,
                    sentAt: new Date(), status: 'failed', errorMessage: reason
                });
            } catch (_) {}
            // A suspension or a rate limit will fail every remaining message
            // and dig the reputation hole deeper. Stop and let a person look.
            if (/suspend|rate|limit|quota|blocked/i.test(reason)) {
                console.log('\nStopping: that reads as a provider block, not a bad address.');
                break;
            }
        }
        await new Promise((r) => setTimeout(r, GAP_MS));
    }

    console.log(`\nsent ${sent}, failed ${failed}, ${queue.length - sent} still to go.`);
    console.log('Run again to continue — anyone already sent is skipped.\n');
    await mongoose.disconnect();
}

main().catch((err) => { console.error('Failed:', err.message); process.exitCode = 1; });
