const nodemailer = require("nodemailer");

function createEmailTransporter() {
    const user = process.env.EMAIL_USER || process.env.EMAIL_US;
    const pass = process.env.EMAIL_PASS;

    // If credentials are not set, return a basic transporter that won't crash on init
    if (!user || !pass) {
        return nodemailer.createTransport({
            jsonTransport: true
        });
    }

    // Auto-detect service: if EMAIL_SERVICE is specified, use it.
    // Otherwise, if the username contains @gmail.com, default to Gmail service.
    const service = process.env.EMAIL_SERVICE || (user.includes("@gmail.com") ? "gmail" : undefined);

    const config = {
        auth: {
            user: user,
            pass: pass
        }
    };

    if (service) {
        config.service = service;
    } else {
        config.host = process.env.EMAIL_HOST || "smtp-relay.brevo.com";
        config.port = parseInt(process.env.EMAIL_PORT) || 587;
        config.secure = process.env.EMAIL_SECURE === "true";
    }

    return nodemailer.createTransport(config);
}

module.exports = {
    createEmailTransporter
};
