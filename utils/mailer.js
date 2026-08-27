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

/*
 * Addresses that are not worth a delivery attempt.
 *
 * Deliberately conservative. A bounce counts against the sending domain, so
 * there is real value in not mailing dead rows — but a false positive here
 * silently denies a real student their certificate, which is worse than a
 * bounce. So this rejects only what cannot be a real mailbox: a malformed
 * address, and the domains RFC 2606 reserves for documentation and testing.
 *
 * It does NOT try to guess from the local part. "test@abc.com" and
 * "asdads@gmail.com" are junk rows in the database, not something a regex
 * should be deciding about — real people are called Test, and abc.com is a
 * registered domain. Those are for HR to delete.
 */
const RESERVED_DOMAINS = new Set([
    'example.com', 'example.net', 'example.org',
    'test', 'example', 'invalid', 'localhost', 'localdomain'
]);

function isSendableAddress(address) {
    const addr = String(address || '').trim().toLowerCase();
    // One @, something either side, a dot in the domain, no whitespace.
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(addr)) return false;
    const domain = addr.slice(addr.lastIndexOf('@') + 1);
    if (RESERVED_DOMAINS.has(domain)) return false;
    // .test / .invalid / .example / .localhost are reserved TLDs.
    if (/\.(test|invalid|example|localhost)$/.test(domain)) return false;
    return true;
}

/*
 * The one email shell.
 *
 * There were three visual identities and five emails with no design at all —
 * the offer letter, the letter of completion and the certificate bundle went
 * out as `<p>Dear X,</p><p>Congratulations!</p>`. Those are exactly the mails a
 * student forwards to a recruiter.
 *
 * This is not a new look. It is the dark-navy-and-gold shell that
 * welcomeEmailHtml, promotionEmailHtml and passwordResetEmailHtml in server.js
 * already use, lifted out so every other send can have it too. Those three are
 * left alone on purpose: they are already this design, and rewriting a working
 * credentials email to reach the same result is a diff for nothing.
 *
 * Table-based and inline-styled because that is what email clients render.
 * Outlook ignores flexbox, Gmail strips <style> blocks.
 */
const PORTAL_URL = (process.env.BASE_URL || 'https://virtualinternships.entrepreneurshipnetwork.net')
    .replace(/\/$/, '');

function escapeHtml(value) {
    return String(value == null ? '' : value)
        .replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/**
 * @param {object} opts
 * @param {string} opts.heading   the line in the gold header
 * @param {string} [opts.name]    who it is addressed to
 * @param {string} opts.bodyHtml  trusted HTML for the body — callers escape their own values
 * @param {{label: string, url: string}} [opts.cta]
 * @param {{label: string, html: string}|string} [opts.panel]  a boxed detail block
 * @param {string} [opts.note]    small print under the button
 * @param {string} [opts.footerWhy] why this person is receiving it. The default
 *        speaks of "your TEN internship account", which is true of every mail
 *        that goes to a student and false of one that goes to somebody who has
 *        only ever typed their address into a box.
 */
function renderEmail({ heading, name, bodyHtml, cta, panel, note, footerWhy } = {}) {  // eslint-disable-line no-param-reassign
    const button = cta && cta.url ? `
      <table cellspacing="0" cellpadding="0" style="margin:24px 0 4px;"><tr><td
        style="background:linear-gradient(135deg,#f5c542,#d9a520);border-radius:10px;">
        <a href="${escapeHtml(cta.url)}" style="display:inline-block;padding:13px 30px;color:#1a1208;
           text-decoration:none;font-weight:700;font-size:14px;">${escapeHtml(cta.label || 'Open my portal')}</a>
      </td></tr></table>` : '';

    /*
     * Three call sites pass a plain HTML string here instead of {label, html}:
     * the registration confirmation, the account-recovery mail and the mail
     * health alert. Each rendered an EMPTY BOX — the detail block those mails
     * exist to carry silently vanished, and the health alert in particular was
     * arriving with nothing in it but "run a script on the server". Accepting
     * the string is the fix for all three at once.
     */
    if (typeof panel === 'string') panel = { label: '', html: panel };

    const panelBlock = panel ? `
      <table width="100%" cellspacing="0" cellpadding="0" style="background:#0c1220;
             border:1px solid rgba(245,197,66,0.15);border-radius:12px;margin:18px 0;">
        <tr><td style="padding:18px 22px;">
          <div style="color:#f5c542;font-size:11px;letter-spacing:2px;font-weight:700;">${escapeHtml(panel.label || '')}</div>
          <div style="margin-top:10px;font-size:14px;line-height:1.85;color:#f0eee8;">${panel.html || ''}</div>
        </td></tr>
      </table>` : '';

    return `<!doctype html><html><body style="margin:0;background:#0c1220;font-family:Segoe UI,Arial,sans-serif;color:#f0eee8;">
<table width="100%" cellspacing="0" cellpadding="0" style="background:#0c1220;padding:32px 0;"><tr><td align="center">
  <table width="600" cellspacing="0" cellpadding="0" style="max-width:600px;background:#0e1628;
         border:1px solid rgba(245,197,66,0.18);border-radius:18px;overflow:hidden;">
    <tr><td style="background:linear-gradient(135deg,#1a1208,#3a2a08);padding:26px 32px;text-align:center;">
      <div style="font-size:12px;letter-spacing:5px;color:#f5c542;font-weight:700;">THE ENTREPRENEURSHIP NETWORK</div>
      <div style="font-size:21px;color:#fff7d6;font-weight:800;margin-top:8px;">${escapeHtml(heading || '')}</div>
    </td></tr>
    <tr><td style="padding:28px 34px;">
      ${name ? `<p style="font-size:15px;line-height:1.55;margin:0 0 14px;">Dear <b>${escapeHtml(name)}</b>,</p>` : ''}
      <div style="font-size:15px;line-height:1.65;color:#e8e5dd;">${bodyHtml || ''}</div>
      ${panelBlock}
      ${button}
      ${note ? `<p style="margin:14px 0 0;font-size:12px;color:#cdb24a;">${note}</p>` : ''}
    </td></tr>
    <tr><td style="padding:18px 34px 26px;border-top:1px solid rgba(245,197,66,0.12);">
      <p style="margin:0;font-size:11px;line-height:1.6;color:#8b8578;">
        The Entrepreneurship Network · <a href="${PORTAL_URL}" style="color:#cdb24a;">${PORTAL_URL.replace(/^https?:\/\//, '')}</a><br>
        ${escapeHtml(footerWhy || 'You are receiving this because of activity on your TEN internship account.')}
      </p>
    </td></tr>
  </table>
</td></tr></table>
</body></html>`;
}

/** True when this process can actually deliver mail. */
function mailerReady() {
    const { user, pass } = smtpCredentials();
    return !!(user && pass);
}

/**
 * @param {{pool?: boolean}} [opts] pool:true reuses ONE connection and throttles.
 *        Use it for a long-running process; a script that ends should not, or
 *        the open sockets keep it alive after its work is done.
 */
function createEmailTransporter(opts = {}) {
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

    if (opts.pool) {
        /*
         * The weekly cohort mailer sends 150+ messages in a tight loop. Without
         * a pool every one of those is a fresh TCP connection AND a fresh SMTP
         * login, and a provider answers a burst of logins with "Too many login
         * attempts, please try again later" — which is a whole cohort of mail
         * failing at once while a single alert sent later goes through fine.
         *
         * ponytail: one connection at five messages a second. If volume ever
         * outgrows that, raise maxConnections before reaching for a queue.
         */
        Object.assign(config, {
            pool: true, maxConnections: 1, maxMessages: 100,
            rateDelta: 1000, rateLimit: 5
        });
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
    isSendableAddress,
    renderEmail,
    escapeHtml,
    PORTAL_URL,
    EMAIL_FROM,
    HR_NOTIFY_EMAIL
};
