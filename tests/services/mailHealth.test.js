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
