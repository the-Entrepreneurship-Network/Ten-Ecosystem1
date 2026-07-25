const nodemailer = require("nodemailer");

// Single sender identity used for every outgoing email in the app
const EMAIL_FROM = process.env.EMAIL_FROM || '"TEN HR" <hr@entrepreneurshipnetwork.net>';

function createEmailTransporter() {
    const user = process.env.SES_SMTP_USER;
    const pass = process.env.SES_SMTP_PASS;
    const host = process.env.SES_SMTP_HOST || "email-smtp.ap-south-1.amazonaws.com";
    const port = parseInt(process.env.SES_SMTP_PORT) || 587;

    if (!user || !pass) {
        console.warn("[mailer] SES_SMTP_USER/SES_SMTP_PASS not set — emails will not actually be sent.");
        return nodemailer.createTransport({ jsonTransport: true });
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

