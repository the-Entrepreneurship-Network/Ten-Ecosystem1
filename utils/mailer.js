const nodemailer = require("nodemailer");

// Single sender identity used for every outgoing email in the app
const EMAIL_FROM = process.env.EMAIL_FROM || '"TEN HR" <hr@entrepreneurshipnetwork.net>';

function createEmailTransporter() {
    const user = process.env.SMTP_USER || process.env.SES_SMTP_USER;
    const pass = process.env.SMTP_PASS || process.env.SES_SMTP_PASS;
    const host = process.env.SMTP_HOST || process.env.SES_SMTP_HOST || "email-smtp.ap-south-1.amazonaws.com";
    const port = parseInt(process.env.SMTP_PORT || process.env.SES_SMTP_PORT) || 587;
    const service = process.env.SMTP_SERVICE; // e.g. 'gmail'

    if (!user || !pass) {
        console.warn("[mailer] SMTP credentials (SMTP_USER / SMTP_PASS) not set in .env — live email sending is paused for local dev.");
        return nodemailer.createTransport({ jsonTransport: true });
    }

    if (service && service.toLowerCase() === "gmail") {
        return nodemailer.createTransport({
            service: "gmail",
            auth: { user, pass }
        });
    }

    return nodemailer.createTransport({
        host: host,
        port: port,
        secure: port === 465,
        auth: { user, pass }
    });
}

module.exports = {
    createEmailTransporter,
    EMAIL_FROM
};

