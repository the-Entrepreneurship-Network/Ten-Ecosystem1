const nodemailer = require("nodemailer");

/*
 * Where the SMTP credentials come from — ONE definition.
 *
 * The chain existed here already, and then two other files wrote their own.
 * routes/v2/certificates.js asked only for EMAIL_USER and EMAIL_PASS, so a
 * server configured with SMTP_USER/SMTP_PASS — which this transporter is
 * perfectly happy with — had every certificate email skipped with
 * "[Email] EMAIL_USER or EMAIL_PASS not set", in bursts, while every other
 * mail on the same box sent fine. Students got their certificate in the
 * portal and no email, and the log said so hundreds of times without anyone
 * reading it as a bug.
 *
 * Nobody re-derives this. Call mailerReady() and ask.
 */
function smtpCredentials() {
    return {
        user: process.env.SMTP_USER || process.env.SES_SMTP_USER || process.env.EMAIL_USER || process.env.EMAIL_US,
        pass: process.env.SMTP_PASS || process.env.SES_SMTP_PASS || process.env.EMAIL_PASS,
        host: process.env.SMTP_HOST || process.env.SES_SMTP_HOST || process.env.EMAIL_HOST || "smtp-relay.brevo.com",
        port: parseInt(process.env.SMTP_PORT || process.env.SES_SMTP_PORT || process.env.EMAIL_PORT) || 587
    };
}

/** True when this process can actually deliver mail. */
function mailerReady() {
    const { user, pass } = smtpCredentials();
    return !!(user && pass);
}

function createEmailTransporter() {
    const { user, pass, host, port } = smtpCredentials();
    const service = process.env.SMTP_SERVICE || process.env.EMAIL_SERVICE || (user && user.includes("@gmail.com") ? "gmail" : undefined);

    // If credentials are not set, return a basic transporter that won't crash on init
    if (!user || !pass) {
        console.warn("[mailer] SMTP credentials not set in .env — live email sending is paused for local dev.");
        return nodemailer.createTransport({ jsonTransport: true });
    }

    const config = {
        auth: { user, pass }
    };

    if (service) {
        config.service = service;
    } else {
        config.host = host;
        config.port = port;
        config.secure = port === 465 || process.env.EMAIL_SECURE === "true";
    }

    return nodemailer.createTransport(config);
}

/*
 * The From address, in one place.
 *
 * Seven call sites already destructured `EMAIL_FROM` from this file —
 * server.js's password reset, the mentor-booking mails, the coin receipts —
 * and this module never exported it. Every one of them passed `undefined` as
 * `from`, nodemailer refused the message, and the throw was swallowed into a
 * "failed" row in MailHistory that nobody reads. Those emails have never been
 * delivered. Exporting it is the whole fix.
 */
const EMAIL_FROM =
    process.env.EMAIL_FROM ||
    (process.env.SMTP_USER || process.env.EMAIL_USER
        ? `TEN <${process.env.SMTP_USER || process.env.EMAIL_USER}>`
        : 'TEN <no-reply@entrepreneurshipnetwork.net>');

/*
 * Where the team's own notices go — a student submitted documents, a
 * certificate needs approving.
 *
 * Three call sites addressed these to process.env.EMAIL_US, which is a typo of
 * EMAIL_USER that spread by copy-paste. Unset, `to` was undefined, the send
 * threw, and every one of those sites swallowed the error — so HR was never
 * told a student had submitted anything. The default is the address
 * routes/v2/payment.js already hardcodes for exactly this purpose.
 */
const HR_NOTIFY_EMAIL =
    (process.env.HR_NOTIFY_EMAIL || '').trim() || 'growth@entrepreneurshipnetwork.net';

module.exports = {
    createEmailTransporter,
    mailerReady,
    smtpCredentials,
    EMAIL_FROM,
    HR_NOTIFY_EMAIL
};
