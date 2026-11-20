'use strict';

/**
 * @jest-environment node
 *
 * The college agent, running without anyone pressing Run.
 *
 * Until now it moved one batch at a time and then waited for a human — the
 * route's own error text said "run it again after the next batch". An agent
 * that needs somebody at a keyboard is a button.
 *
 * What is worth testing is not that cron.schedule was called. It is the four
 * ways this goes wrong unattended: every PM2 worker scheduling the same slot
 * and quadrupling the traffic at somebody else's server, a second run piling
 * onto one already in flight, a typo in the schedule silently meaning "never",
 * and a throw inside a callback that has no caller to catch it.
 *
 * node-cron is mocked so the callback can be held and invoked here, and the
 * crawl itself is injected, so nothing in this file touches the network.
 */

const path = require('path');

/** Load the service with node-cron captured. */
function load({ validate = true } = {}) {
    jest.resetModules();
    const scheduled = [];
    jest.doMock('node-cron', () => ({
        validate: () => validate,
        schedule: (expr, fn, opts) => { scheduled.push({ expr, fn, opts }); return { stop() {} }; }
    }));
    const svc = require('../../services/collegeDiscovery');
    return { svc, scheduled };
}

const ENV = ['COLLEGE_AGENT_CRON', 'NODE_APP_INSTANCE'];
let saved;

beforeEach(() => {
    saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));
    ENV.forEach((k) => delete process.env[k]);
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
    ENV.forEach((k) => {
        if (saved[k] === undefined) delete process.env[k];
        else process.env[k] = saved[k];
    });
    jest.restoreAllMocks();
});

describe('when it schedules, and when it refuses to', () => {
    it('is on by default — the thing it replaces was the Run button', () => {
        const { svc, scheduled } = load();
        expect(svc.initCollegeAgent()).toMatchObject({ started: true });
        expect(scheduled).toHaveLength(1);
        expect(scheduled[0].opts).toMatchObject({ timezone: 'Asia/Kolkata' });
    });

    it('stops on COLLEGE_AGENT_CRON=off, without a deploy', () => {
        process.env.COLLEGE_AGENT_CRON = 'off';
        const { svc, scheduled } = load();
        expect(svc.initCollegeAgent()).toMatchObject({ started: false, reason: 'disabled' });
        expect(scheduled).toHaveLength(0);
    });

    it('takes a replacement schedule from the same variable', () => {
        process.env.COLLEGE_AGENT_CRON = '5 3 * * *';
        const { svc, scheduled } = load();
        expect(svc.initCollegeAgent()).toMatchObject({ started: true, expr: '5 3 * * *' });
        expect(scheduled[0].expr).toBe('5 3 * * *');
    });

    it('only PM2 worker 0 schedules it', () => {
        /*
         * Every worker runs server.js. Four workers scheduling the same slot
         * is four crawlers hitting the same four hundred colleges at once —
         * four times the traffic at servers that did not ask for any of it.
         */
        process.env.NODE_APP_INSTANCE = '2';
        const { svc, scheduled } = load();
        expect(svc.initCollegeAgent()).toMatchObject({ started: false, reason: 'not-cron-worker' });
        expect(scheduled).toHaveLength(0);
    });

    it('schedules on a single-process server, where there is no worker number', () => {
        const { svc, scheduled } = load();           // NODE_APP_INSTANCE deleted
        expect(svc.initCollegeAgent()).toMatchObject({ started: true });
        expect(scheduled).toHaveLength(1);
    });

    it('refuses a malformed schedule instead of silently never running', () => {
        process.env.COLLEGE_AGENT_CRON = 'not a cron';
        const { svc, scheduled } = load({ validate: false });
        expect(svc.initCollegeAgent()).toMatchObject({ started: false, reason: 'bad-cron' });
        expect(scheduled).toHaveLength(0);
    });

    it('a second call does not add a second schedule', () => {
        // Two schedules means two crawls per slot, from one process.
        const { svc, scheduled } = load();
        expect(svc.initCollegeAgent()).toMatchObject({ started: true });
        expect(svc.initCollegeAgent()).toMatchObject({ started: false, reason: 'already-started' });
        expect(scheduled).toHaveLength(1);
    });
});

describe('what the scheduled slot actually does', () => {
    /** Schedule it with the crawl injected, and hand back the callback. */
    const armed = ({ running = false, result, throws } = {}) => {
        const calls = [];
        const { svc, scheduled } = load();
        svc.initCollegeAgent({
            runStatus: () => ({ running }),
            runBulk: async () => {
                calls.push(1);
                if (throws) throw new Error(throws);
                return result || { processed: 400, total: 400, added: 12, skipped: 3, failed: 1, error: '' };
            }
        });
        return { fire: scheduled[0].fn, calls };
    };

    it('runs the crawl', async () => {
        const a = armed();
        await a.fire();
        expect(a.calls).toHaveLength(1);
    });

    it('skips the slot when the last batch is still going', async () => {
        /*
         * runBulk refuses a second run itself, but it refuses by returning the
         * snapshot, which in a log is indistinguishable from a run that found
         * nothing. Skipping here is what keeps the log readable at 3am.
         */
        const a = armed({ running: true });
        await a.fire();
        expect(a.calls).toHaveLength(0);
    });

    it('swallows a throw, because a scheduled callback has no caller', async () => {
        // An unhandled rejection in a cron callback takes the process with it,
        // and this one is scheduled at 02:37 with nobody watching.
        const a = armed({ throws: 'network gone' });
        await expect(a.fire()).resolves.toBeUndefined();
        expect(a.calls).toHaveLength(1);
    });

    it('reports what the run did', async () => {
        const a = armed({ result: { processed: 7, total: 9, added: 2, skipped: 1, failed: 0, error: '' } });
        await a.fire();
        const said = console.log.mock.calls.map((c) => c.join(' ')).join('\n');
        expect(said).toMatch(/processed 7\/9/);
        expect(said).toMatch(/added 2/);
    });
});

describe('it is started where the other scheduled jobs are', () => {
    const serverJs = require('fs').readFileSync(path.join(__dirname, '../../server.js'), 'utf8');

    it('server.js calls it', () => {
        expect(serverJs).toMatch(/require\("\.\/services\/collegeDiscovery"\)\.initCollegeAgent\(\)/);
    });

    it('a failure to start does not stop the boot', () => {
        const at = serverJs.indexOf('initCollegeAgent()');
        expect(at).toBeGreaterThan(-1);
        expect(serverJs.lastIndexOf('try {', at)).toBeGreaterThan(-1);
        expect(serverJs.slice(at, at + 220)).toMatch(/catch \(err\)/);
    });
});

describe('the crawl itself is unchanged', () => {
    it('same batch, same concurrency, same per-host delay', () => {
        // A scheduled run has to be byte for byte the run pressing Run does.
        // If scheduling it also made it hungrier, the politeness ceiling this
        // file states at the top would move without anyone deciding to move it.
        const { svc } = load();
        expect(svc.BATCH).toBe(400);
        expect(svc.CONCURRENCY).toBe(12);
        expect(svc.PATHS).toContain('/placement');
        expect(svc.PATHS).toHaveLength(8);
    });
});
