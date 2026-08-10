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

module.exports = {
    createEmailTransporter
};
