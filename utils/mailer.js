const nodemailer = require("nodemailer");

function createEmailTransporter() {
    const user = process.env.SMTP_USER || process.env.SES_SMTP_USER || process.env.EMAIL_USER || process.env.EMAIL_US;
    const pass = process.env.SMTP_PASS || process.env.SES_SMTP_PASS || process.env.EMAIL_PASS;
    const host = process.env.SMTP_HOST || process.env.SES_SMTP_HOST || process.env.EMAIL_HOST || "smtp-relay.brevo.com";
    const port = parseInt(process.env.SMTP_PORT || process.env.SES_SMTP_PORT || process.env.EMAIL_PORT) || 587;
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

module.exports = {
    createEmailTransporter,
    EMAIL_FROM
};
