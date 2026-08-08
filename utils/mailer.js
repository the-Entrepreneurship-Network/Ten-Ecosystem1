const fs = require("fs");
const path = require("path");
const nodemailer = require("nodemailer");

function findProjectRoot(startDir = process.cwd()) {
    const candidateDirs = new Set();
    const resolvedStartDir = path.resolve(startDir);
    const moduleRoot = path.resolve(__dirname, "..");

    [resolvedStartDir, moduleRoot].forEach((dir) => {
        let currentDir = path.resolve(dir);
        while (true) {
            candidateDirs.add(currentDir);
            const envPath = path.join(currentDir, ".env");
            if (fs.existsSync(envPath)) {
                return currentDir;
            }

            const parentDir = path.dirname(currentDir);
            if (parentDir === currentDir) {
                break;
            }
            currentDir = parentDir;
        }
    });

    for (const dir of candidateDirs) {
        const envPath = path.join(dir, ".env");
        if (fs.existsSync(envPath)) {
            return dir;
        }
    }

    return null;
}

function loadEnvironment(startDir = process.cwd()) {
    const projectRoot = findProjectRoot(startDir);
    if (!projectRoot) {
        return { error: "No project .env file found" };
    }

    const envPath = path.join(projectRoot, ".env");
    const envContents = fs.readFileSync(envPath, "utf8");

    for (const line of envContents.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) {
            continue;
        }

        const separatorIndex = trimmed.indexOf("=");
        if (separatorIndex === -1) {
            continue;
        }

        const key = trimmed.slice(0, separatorIndex).trim();
        const rawValue = trimmed.slice(separatorIndex + 1).trim();
        const value = rawValue.replace(/^['"]|['"]$/g, "");

        if (!Object.prototype.hasOwnProperty.call(process.env, key)) {
            process.env[key] = value;
        }
    }

    return { projectRoot, envPath };
}

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

    const shouldVerifySmtp = process.env.DISABLE_SMTP_VERIFY !== 'true' && process.env.NODE_ENV === 'production';
    if (shouldVerifySmtp) {
        transporter.verify((error) => {
            if (error) {
                console.log(`SMTP verification status: OFFLINE — ${error.message}`);
            } else {
                console.log("SMTP verification status: ONLINE");
            }
        });
    } else {
        console.log("[mailer] SMTP verification skipped in non-production mode.");
    }

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
    loadEnvironment,
    findProjectRoot,
};
