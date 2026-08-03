const nodemailer = require("nodemailer");

// Single sender identity used for every outgoing email in the app.
const EMAIL_FROM = process.env.EMAIL_FROM || '"TEN HR" <lavyakhandelwal23@gmail.com>';

function createEmailTransporter() {
    const user = process.env.SES_SMTP_USER || process.env.EMAIL_USER || process.env.EMAIL_US;
    const pass = process.env.SES_SMTP_PASS || process.env.EMAIL_PASS;
    const host = process.env.SMTP_HOST || process.env.SES_SMTP_HOST || process.env.EMAIL_HOST || "smtp.gmail.com";
    const port = parseInt(process.env.SMTP_PORT || process.env.SES_SMTP_PORT || process.env.EMAIL_PORT, 10) || 587;
    const service = process.env.EMAIL_SERVICE || (user && user.includes("@gmail.com") ? "gmail" : undefined);

    if (!user || !pass) {
        console.warn("[mailer] SMTP credentials missing, falling back to a json transport.");
        return nodemailer.createTransport({ jsonTransport: true });
    }

    const config = {
        host,
        port,
        secure: port === 465,
        auth: {
            user,
            pass,
        },
    };

    if (service) {
        config.service = service;
        delete config.host;
        delete config.port;
        delete config.secure;
    }

    const transporter = nodemailer.createTransport(config);

    transporter.verify((error) => {
        if (error) {
            console.log(`SMTP verification status: OFFLINE — ${error.message}`);
        } else {
            console.log("SMTP verification status: ONLINE");
        }
    });

    return transporter;
}

async function sendWelcomeEmail(userEmail, userName) {
    const transporter = createEmailTransporter();

    const mailOptions = {
        from: EMAIL_FROM,
        to: userEmail,
        subject: "Welcome to TEN! 🎉",
        html: `
            <div style="font-family: Arial, sans-serif; padding: 20px; color: #333;">
                <h2>Hi ${userName || 'there'}, welcome aboard! 👋</h2>
                <p>Thank you for registering on our platform. Your account has been successfully created.</p>
                <p>We're super excited to have you here! You can now log in and start exploring.</p>
                <br />
                <a href="${process.env.APP_URL || 'http://localhost:3000'}/login"
                   style="background-color: #4CAF50; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px;">
                   Go to Dashboard
                </a>
                <br /><br />
                <p>Best regards,<br />The TEN Team</p>
            </div>
        `,
    };

    return transporter.sendMail(mailOptions);
}

async function sendPasswordResetEmail(userEmail, resetToken) {
    const transporter = createEmailTransporter();
    const appUrl = process.env.APP_URL || 'http://localhost:3000';
    const resetLink = `${appUrl}/reset-password?token=${resetToken}`;

    const mailOptions = {
        from: EMAIL_FROM,
        to: userEmail,
        subject: "Password Reset Request — TEN Platform 🔐",
        html: `
            <div style="font-family: Arial, sans-serif; padding: 20px; color: #333; max-width: 600px; margin: auto; border: 1px solid #eee; border-radius: 8px;">
                <h2 style="color: #4F46E5;">Password Reset Request</h2>
                <p>Hello,</p>
                <p>We received a request to reset your password for your TEN account.</p>
                <p>Click the button below to reset it. This link is valid for <strong>1 hour</strong>.</p>
                <br />
                <a href="${resetLink}"
                   style="background-color: #4F46E5; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block; font-weight: bold;">
                   Reset Password
                </a>
                <br /><br />
                <p style="font-size: 13px; color: #666;">If you didn't request this password reset, please ignore this email.</p>
                <hr style="border: none; border-top: 1px solid #eee;" />
                <p style="font-size: 12px; color: #888;">Best regards,<br />The TEN Team</p>
            </div>
        `,
    };

    return transporter.sendMail(mailOptions);
}

module.exports = {
    createEmailTransporter,
    sendWelcomeEmail,
    sendPasswordResetEmail,
    EMAIL_FROM,
};
