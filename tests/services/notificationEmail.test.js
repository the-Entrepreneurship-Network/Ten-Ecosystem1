'use strict';

/**
 * Every personal notification also arrives as an email.
 *
 * The portal had ~20 places that tell one student something happened and all
 * of them ended at an in-app bell. Rather than add a sendMail call to each,
 * the Notification model mirrors itself — so a notification added next year is
 * emailed without anyone remembering to wire it up.
 *
 * Two things that must hold, and would be silent if they broke:
 *
 *   A broadcast is never emailed. One "all" row means hundreds of messages,
 *   and a burst like that from a young sending domain is how you get the
 *   domain blocked.
 *
 *   An event that already sends its own richer mail — an offer letter with the
 *   PDF attached — does not also send this thinner one.
 */

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '../..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

const { mirror, buildHTML } = require('../../services/notificationEmail');

const notif = (over = {}) => Object.assign({
    targetType: 'student',
    targetEmployeeId: 'TEN123',
    title: 'Payment approved',
    message: 'Your fee is settled.',
    type: 'success',
    $locals: {}
}, over);

describe('notification → email mirror', () => {
    afterEach(() => {
        delete process.env.SMTP_USER;
        delete process.env.SMTP_PASS;
    });

    it('never emails a broadcast', async () => {
        process.env.SMTP_USER = 'u';
        process.env.SMTP_PASS = 'p';
        for (const targetType of ['all', 'domain', 'coordinator', 'coordinator-domain']) {
            const out = await mirror(notif({ targetType }));
            expect(out.sent).toBe(false);
            expect(out.reason).toBe('not a personal notification');
        }
    });

    it('respects the opt-out for events that send their own mail', async () => {
        process.env.SMTP_USER = 'u';
        process.env.SMTP_PASS = 'p';
        const out = await mirror(notif({ $locals: { skipEmail: true } }));
        expect(out).toEqual({ sent: false, reason: 'opted out' });
    });

    it('does nothing when email is not configured', async () => {
        const out = await mirror(notif());
        expect(out).toEqual({ sent: false, reason: 'email not configured' });
    });

    it('needs a recipient', async () => {
        process.env.SMTP_USER = 'u';
        process.env.SMTP_PASS = 'p';
        const out = await mirror(notif({ targetEmployeeId: '' }));
        expect(out).toEqual({ sent: false, reason: 'no recipient' });
    });

    it('never throws, whatever it is handed', async () => {
        await expect(mirror(null)).resolves.toEqual({ sent: false, reason: 'no document' });
        await expect(mirror({})).resolves.toEqual(
            { sent: false, reason: 'not a personal notification' });
    });

    it('escapes the notification text into the HTML body', () => {
        const html = buildHTML('Ana', '<script>x</script>', 'a & b', 'info');
        expect(html).not.toContain('<script>');
        expect(html).toContain('&lt;script&gt;');
        expect(html).toContain('a &amp; b');
    });
});

describe('the mirror is hooked where every path goes through it', () => {
    const model = read('models/Notification.js');

    it('hooks the model, not just the notifyStudent helper', () => {
        // services/studentPropagation.js and routes/v2/certificateApplications.js
        // both build `new Notification(...)` by hand and never call the static.
        expect(model).toMatch(/NotificationSchema\.post\("save"/);
        expect(model).toContain('notificationEmail');
    });

    it('the hook cannot fail the notification that was already saved', () => {
        const hook = model.slice(model.indexOf('NotificationSchema.post("save"'));
        expect(hook).toContain('.catch(');
        expect(hook).toContain('try {');
    });

    it('notifyStudent accepts email:false', () => {
        expect(model).toMatch(/email = true/);
        expect(model).toMatch(/if \(!email\) doc\.\$locals\.skipEmail = true/);
    });
});

describe('no event both attaches a PDF and sends the thin mirror', () => {
    const PAIRS = [
        ['routes/v2/certificates.js', '📄 ${docLabel} Issued'],
        ['routes/v2/documents.js', '🎓 Letter of Completion Issued'],
        ['routes/v2/documents.js', '📄 Offer Letter Sent'],
        ['services/automationCron.js', '📄 Offer Letter Ready'],
        ['services/automationCron.js', '🏅 Your Internship Certificates Are Ready!'],
        ['server.js', 'spec.notifTitle']
    ];

    it.each(PAIRS)('%s — %s opts out', (file, title) => {
        const src = read(file);
        const at = src.indexOf(title);
        expect(at).toBeGreaterThan(-1);
        // The opt-out has to be inside the same notifyStudent call as the title.
        const call = src.slice(src.lastIndexOf('notifyStudent(', at), src.indexOf('});', at));
        expect(call).toMatch(/email: false/);
    });
});

describe('one email shell for every send', () => {
    // There were three visual identities and five emails with no design at all
    // — the offer letter, the letter of completion and the certificate bundle
    // went out as `<p>Dear X,</p><p>Congratulations!</p>`. Those are the mails
    // a student forwards to a recruiter.
    const { renderEmail, escapeHtml, PORTAL_URL } = require('../../utils/mailer');

    const BRANDED = [
        'services/notificationEmail.js',
        'routes/v2/certificates.js',
        'routes/v2/documents.js',
        'services/automationCron.js',
        'server.js'
    ];

    it.each(BRANDED)('%s builds its bodies with the shared shell', (file) => {
        expect(read(file)).toContain('renderEmail');
    });

    it('no student-facing send is a bare paragraph any more', () => {
        for (const file of ['routes/v2/documents.js', 'services/automationCron.js']) {
            const src = read(file);
            // The internal HR/coordinator notices are allowed to stay plain —
            // they are work items for the team, not documents for a student.
            const studentBare = src.match(/html:\s*`<p>Dear \$\{student\.name/g) || [];
            expect(studentBare).toHaveLength(0);
        }
    });

    it('escapes what callers pass into the header and greeting', () => {
        const html = renderEmail({ heading: 'A <script>x</script>', name: 'B & C', bodyHtml: '<p>ok</p>' });
        expect(html).not.toContain('<script>');
        expect(html).toContain('A &lt;script&gt;');
        expect(html).toContain('B &amp; C');
        expect(html).toContain('<p>ok</p>');   // body is trusted, callers escape their own
    });

    it('renders a complete document email clients can open', () => {
        const html = renderEmail({ heading: 'H', bodyHtml: '<p>b</p>', cta: { label: 'Go', url: 'https://x.example' } });
        expect(html.startsWith('<!doctype html>')).toBe(true);
        expect(html).toContain('THE ENTREPRENEURSHIP NETWORK');
        expect(html).toContain(PORTAL_URL);
        // Tables and inline styles: Outlook ignores flexbox, Gmail strips <style>.
        expect(html).toContain('<table');
        expect(html).not.toMatch(/<style[\s>]/);
        expect(html).not.toContain('display:flex');
    });

    it('leaves optional pieces out rather than rendering empty boxes', () => {
        const bare = renderEmail({ heading: 'H', bodyHtml: '<p>b</p>' });
        expect(bare).not.toContain('undefined');
        expect(bare).not.toContain('Dear <b>');
    });

    it('escapeHtml is exported for callers building their own panels', () => {
        expect(escapeHtml('<a href="x">&')).toBe('&lt;a href=&quot;x&quot;&gt;&amp;');
    });
});

describe('dashboard-generated notifications stay in-app', () => {
    // These three are created WHILE the student is looking at the dashboard
    // that requested them, and a refresh generates another. Emailing them is a
    // mail loop — the same shape as the auto-document resend that got the
    // sending account suspended.
    const IN_APP_ONLY = [
        'New Automated Task Assigned',
        'New Automated Coding Challenge',
        'Daily Micro-Learning'
    ];

    it.each(IN_APP_ONLY)('%s does not email', (title) => {
        const src = read('routes/v2/studentPortal.js');
        const at = src.indexOf(title);
        expect(at).toBeGreaterThan(-1);
        const call = src.slice(src.lastIndexOf('notifyStudent(', at), src.indexOf('});', at));
        expect(call).toMatch(/email: false/);
    });
});

describe('the EMAIL_US typo is gone from every send', () => {
    const FILES = ['routes/v2/documents.js', 'services/automationCron.js',
                   'routes/v2/certificates.js', 'routes/v2/payment.js', 'server.js'];

    it.each(FILES)('%s addresses no mail with EMAIL_US', (file) => {
        const src = read(file);
        expect(src).not.toMatch(/from:\s*process\.env\.EMAIL_US\b/);
        expect(src).not.toMatch(/to:\s*process\.env\.EMAIL_US\b/);
    });

    it('the team notice address has one definition', () => {
        expect(read('utils/mailer.js')).toMatch(/HR_NOTIFY_EMAIL/);
        expect(read('routes/v2/payment.js')).not.toContain("to: 'growth@entrepreneurshipnetwork.net'");
    });
});
