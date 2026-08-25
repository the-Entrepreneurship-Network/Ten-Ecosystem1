'use strict';

/**
 * The job whose absence is the whole story.
 *
 * Every individual mail bug was small and each failed quietly: credentials
 * unset, a From address on a domain the relay would not send for, a typo'd env
 * var, a catch that reported failure as success. Any one would have been a
 * ten-minute fix on the day it started. Instead 790 students registered over
 * months and not one welcome email arrived, because nothing was watching.
 *
 * MailHistory recorded every failure the whole time. Nobody read it.
 */

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '../..');
const src = fs.readFileSync(path.join(root, 'services/automationCron.js'), 'utf8');
const cron = require('../../services/automationCron');

describe('mail health check', () => {
    it('is exported and scheduled daily', () => {
        expect(typeof cron.checkMailHealth).toBe('function');
        expect(src).toMatch(/cron\.schedule\("0 8 \* \* \*", checkMailHealth, options\)/);
    });

    it('reads the record that already existed rather than adding a new one', () => {
        // MailHistory has held every status all along. The gap was reading it.
        const fn = src.slice(src.indexOf('async function checkMailHealth'));
        const body = fn.slice(0, fn.indexOf('\n}'));
        expect(body).toMatch(/MailHistory\.countDocuments/);
        expect(body).toMatch(/status: "failed"/);
    });

    it('says nothing on a good day', () => {
        /*
         * An alert that arrives every morning stops being an alert by the end
         * of the week. It only mails when the rate is genuinely bad.
         */
        const fn = src.slice(src.indexOf('async function checkMailHealth'));
        const body = fn.slice(0, fn.indexOf('\n}'));
        const quietReturn = body.indexOf('alerted: false');
        const sendMail = body.indexOf('sendMail');
        expect(quietReturn).toBeGreaterThan(-1);
        expect(quietReturn).toBeLessThan(sendMail);
    });

    it('will not cry wolf over a tiny sample', () => {
        // One bounce out of two sends is 50% and means nothing.
        const min = Number(/const MAIL_HEALTH_MIN_SAMPLE = (\d+)/.exec(src)[1]);
        expect(min).toBeGreaterThanOrEqual(3);
        const fn = src.slice(src.indexOf('async function checkMailHealth'));
        expect(fn.slice(0, 1500)).toMatch(/total < MAIL_HEALTH_MIN_SAMPLE/);
    });

    it('has a threshold that would have caught the real outage', () => {
        /*
         * The actual failure was 21 attempted, 0 succeeded — 100%. Any sane
         * threshold catches that, but it must also be low enough to catch a
         * partial break, which is the kind that hides.
         */
        const pct = Number(/const MAIL_HEALTH_FAIL_PCT   = (\d+)/.exec(src)[1]);
        expect(pct).toBeGreaterThan(0);
        expect(pct).toBeLessThanOrEqual(50);
    });

    it('reports why, not just how many', () => {
        // "suspended" and "Invalid login" need completely different actions.
        const fn = src.slice(src.indexOf('async function checkMailHealth'));
        const body = fn.slice(0, fn.indexOf('\n}'));
        expect(body).toMatch(/errorMessage/);
        expect(body).toMatch(/reasons/);
    });

    it('never lets a failed alert take down the cron', () => {
        // If the alert itself cannot send, the log line is the alert.
        const fn = src.slice(src.indexOf('async function checkMailHealth'));
        const body = fn.slice(0, fn.indexOf('\n}'));
        expect(body).toMatch(/catch \(mailErr\)/);
        expect(body).toMatch(/catch \(err\)/);
    });
});

/**
 * The thresholds, exercised rather than asserted about.
 *
 * The counts come from stubs, so this runs the real branching without a
 * database and without sending anything.
 */
describe('mail health thresholds, run for real', () => {
    const MailHistory = require('../../models/MailHistory');

    /*
     * No transporter stub. automationCron destructures createEmailTransporter
     * at module load, so a spy on the mailer module is never seen — and with
     * no SMTP credentials in the test environment the mailer hands back
     * nodemailer's jsonTransport, which accepts the message and sends nothing.
     * The alert is therefore exercised without leaving the process, and what
     * the check DECIDED is read from its return value.
     */
    afterEach(() => jest.restoreAllMocks());

    /** total sends and failures in the last 24h */
    const stub = (total, failed) => {
        jest.spyOn(MailHistory, 'countDocuments').mockImplementation((q) =>
            Promise.resolve(q && q.status === 'failed' ? failed : total));
        jest.spyOn(MailHistory, 'find').mockReturnValue({
            select: () => ({ limit: () => ({ lean: async () =>
                Array.from({ length: failed }, () => ({ errorMessage: '554 suspended' })) }) })
        });
    };

    it('stays quiet when almost everything sends', async () => {
        stub(100, 2);                       // 2%
        const r = await cron.checkMailHealth();
        expect(r.alerted).toBe(false);
        expect(r.reasons).toBeUndefined();   // never even looked them up
    });

    it('stays quiet on a sample too small to mean anything', async () => {
        stub(2, 2);                         // 100% of two
        const r = await cron.checkMailHealth();
        expect(r.alerted).toBe(false);
        expect(r.total).toBe(2);
    });

    it('alerts on the outage that actually happened', async () => {
        stub(21, 21);                       // 21 attempted, 0 succeeded
        const r = await cron.checkMailHealth();
        expect(r.alerted).toBe(true);
        expect(r.pct).toBe(100);
        // The reason is carried, not just the count — "suspended" and
        // "Invalid login" need completely different actions.
        expect(r.reasons[0].reason).toMatch(/suspended/);
        expect(r.reasons[0].count).toBe(21);
    });

    it('alerts on a partial break — the kind that hides', async () => {
        stub(100, 40);                      // 40%
        const r = await cron.checkMailHealth();
        expect(r.alerted).toBe(true);
        expect(r.pct).toBe(40);
        expect(r.reasons[0].count).toBe(40);
    });

    it('reports rather than throws when the database itself is unreachable', async () => {
        jest.spyOn(MailHistory, 'countDocuments').mockRejectedValue(new Error('no connection'));
        const r = await cron.checkMailHealth();
        expect(r.error).toBe('no connection');   // caught, cron survives
    });
});


/**
 * Asking by hand.
 *
 * checkMailHealth assumes the connection the server process already holds.
 * Run standalone it has none, so the query buffers and dies after ten seconds
 * with "Operation `mailhistories.countDocuments()` buffering timed out" —
 * which reads as a broken check rather than a missing connection, and is
 * exactly what a documented `node -e` one-liner produced.
 *
 * scripts/check-mail-health.js owns the connection instead, the same split as
 * scripts/check-email.js.
 */
describe('the by-hand check', () => {
    const script = fs.readFileSync(path.join(root, 'scripts/check-mail-health.js'), 'utf8');
    /* The script quotes the buffering error in its own doc comment, so an
       offset search over the raw text finds the prose before the code. */
    const scriptCode = script
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');

    it('connects before it queries anything', () => {
        const connectAt = scriptCode.indexOf('await mongoose.connect');
        const modelAt = scriptCode.indexOf("require('../models/MailHistory')");
        const queryAt = scriptCode.indexOf('MailHistory.countDocuments');
        expect(connectAt).toBeGreaterThan(-1);
        expect(connectAt).toBeLessThan(modelAt);
        expect(connectAt).toBeLessThan(queryAt);
    });

    it('refuses to run without a database URI rather than hanging', () => {
        expect(script).toMatch(/if \(!process\.env\.MONGODB_URI\)/);
    });

    it('reads only — the 08:00 job is what alerts', () => {
        // A hand-run that also fired an alert would train everyone to ignore
        // the alert.
        expect(scriptCode).not.toMatch(/sendMail/);
    });

    it('the cron function no longer advertises a node -e that cannot work', () => {
        expect(src).not.toMatch(/node -e "require\('\.\/services\/automationCron'\)/);
        expect(src).toMatch(/scripts\/check-mail-health\.js/);
    });
});


/**
 * A second deployment must not run the automation against the same database.
 *
 * A staging copy was running from /home/ec2-user/ten-portal-staging with the
 * SAME MONGODB_URI as production, so all six jobs fired twice — two processes
 * issuing offer letters, generating certificates and auto-marking attendance
 * for the same real students.
 *
 * It surfaced only as 31 MailHistory rows reading "Email not configured",
 * because staging has no SMTP credentials. A small symptom of a large problem,
 * and the only reason anyone noticed.
 */
describe('the cron guard', () => {
    /*
     * Only the disabled path is exercised here, and deliberately so: proving
     * the enabled path in-process means letting initAutomation register six
     * live cron jobs inside the test runner, which then never exits. Mocking
     * node-cron to count them looked like the answer and quietly did not work
     * — the isolated module registry handed automationCron the real library,
     * the counter stayed at zero, and the disabled case "passed" for the wrong
     * reason. A test that passes when the thing it measures is broken is worse
     * than no test.
     *
     * The enabled path was verified directly instead, with node-cron's export
     * replaced before the require: 6 jobs with the flag unset, 0 with it set.
     * What is pinned below is that the guard cannot creep from opt-out to
     * opt-in, which is the change that would silently stop production.
     */
    const guard = src.slice(src.indexOf('function initAutomation'));
    const head = guard.slice(0, guard.indexOf('const options'));

    it('turns the automation off for a deployment that opts out', () => {
        const before = process.env.DISABLE_CRON_JOBS;
        process.env.DISABLE_CRON_JOBS = 'true';
        const logged = [];
        const realLog = console.log;
        console.log = (...a) => logged.push(a.join(' '));
        try {
            jest.isolateModules(() => {
                require('../../services/automationCron').initAutomation();
            });
        } finally {
            console.log = realLog;
            if (before === undefined) delete process.env.DISABLE_CRON_JOBS;
            else process.env.DISABLE_CRON_JOBS = before;
        }
        expect(logged.join('\n')).toMatch(/automation is off for this deployment/);
        // And it never got as far as announcing a schedule.
        expect(logged.join('\n')).not.toMatch(/cron jobs scheduled/);
    });

    it('is opt-OUT, so production never depends on remembering a flag', () => {
        /*
         * An opt-in gate would stop production the moment somebody forgot to
         * set it, and these jobs failing silently is exactly the class of bug
         * this codebase has been full of.
         */
        expect(head).toMatch(/DISABLE_CRON_JOBS/);
        expect(head).not.toMatch(/ENABLE_CRON|RUN_CRON/);
        // Only an explicit "true" turns them off.
        expect(head).toMatch(/=== "true"/);
    });

    it('checks the flag before anything is scheduled', () => {
        const flagAt = head.indexOf('DISABLE_CRON_JOBS');
        const startedAt = head.indexOf('automationStarted = true');
        expect(flagAt).toBeGreaterThan(-1);
        expect(flagAt).toBeLessThan(startedAt);
    });
});
