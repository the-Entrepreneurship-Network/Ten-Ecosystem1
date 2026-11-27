'use strict';

/**
 * @jest-environment node
 *
 * Refer & Earn over HTTP, and how it is wired into the portal.
 *
 *   routes/v2/referrals.js   the student's page data, QR code, ambassador application
 *   routes/adminPortal.js    overview, ambassador decisions, freeze, settle now
 *   routes/growth.js         students' links are one row in the sign-up report
 *   the pages                dashboard menu and card, /refer, the sign-up note
 *
 * The rules themselves are tested in tests/services/referrals.test.js.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const express = require('express');
const request = require('supertest');

const root = path.join(__dirname, '../..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');

const STUDENT = { _id: '65a000000000000000000001', employeeId: 'TEN/WEB/1001', name: 'Priya Sharma', email: 'priya@example.com' };

function fakeService(calls, over = {}) {
    class ReferralError extends Error {
        constructor(code, message, status = 400) { super(message); this.code = code; this.status = status; }
    }
    return {
        ReferralError,
        summarize: async (s) => { calls.summarized.push(s.employeeId); return { code: 'abc2345', link: 'https://portal.test/register?ref=stu-abc2345' }; },
        ensureCode: async () => 'abc2345',
        linkFor: (c) => 'https://portal.test/register?ref=stu-' + c,
        applyAmbassador: async (s, body) => {
            if (over.notYet) throw new ReferralError('not_yet', 'You can apply at 10 paying friends. You have 3.', 403);
            calls.applied.push(body);
            return { status: 'applied', college: body.college };
        },
        adminOverview: async () => ({ totals: { referrers: 1 }, referrers: [], applications: [] }),
        settleAll: async () => { calls.settled += 1; return { referrers: 1, created: 2 }; },
        decideAmbassador: async (id, action, admin, note) => {
            if (over.collegeTaken) throw new ReferralError('college_taken', 'NIT Trichy already has a Campus Ambassador.', 409);
            calls.decided.push({ id, action, admin, note });
            return { status: action === 'approve' ? 'approved' : 'rejected' };
        },
        setFrozen: async (id, frozen) => { calls.frozen.push({ id, frozen }); return { frozen }; }
    };
}

describe('/api/v2/referrals (the student)', () => {
    function mount({ signedIn = true, ...over } = {}) {
        jest.resetModules();
        const calls = { summarized: [], applied: [] };
        jest.doMock('../../models/Student', () => ({
            findOne: async (q) => (q.employeeId === STUDENT.employeeId ? { ...STUDENT } : null),
            findById: async () => null
        }));
        jest.doMock('../../services/referrals', () => fakeService(calls, over));
        const app = express();
        app.use(express.json());
        app.use((req, _res, next) => { req.session = signedIn ? { student: { employeeId: STUDENT.employeeId } } : {}; next(); });
        app.use('/api/v2/referrals', require('../../routes/v2/referrals'));
        return { app, calls };
    }

    it.each(['/me', '/qr.png'])('%s needs a signed-in student', async (route) => {
        const r = await request(mount({ signedIn: false }).app).get('/api/v2/referrals' + route);
        expect(r.status).toBe(401);
        expect(r.headers['x-session-expired']).toBe('1');
    });

    it('answers for the student in the session, whatever the address says', async () => {
        const { app, calls } = mount();
        const r = await request(app).get('/api/v2/referrals/me?employeeId=TEN/WEB/9999');
        expect(r.status).toBe(200);
        expect(r.body).toMatchObject({ success: true, code: 'abc2345' });
        expect(calls.summarized).toEqual([STUDENT.employeeId]);
    });

    it('draws the QR code as a PNG, and offers it as a download', async () => {
        const { app } = mount();
        const r = await request(app).get('/api/v2/referrals/qr.png?download=1').buffer(true)
            .parse((res, cb) => { const b = []; res.on('data', (c) => b.push(c)); res.on('end', () => cb(null, Buffer.concat(b))); });
        expect(r.status).toBe(200);
        expect(r.headers['content-type']).toBe('image/png');
        expect(r.headers['content-disposition']).toContain('attachment');
        expect(r.body.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
    });

    it('an application before 10 paying friends is refused with the reason', async () => {
        const r = await request(mount({ notYet: true }).app).post('/api/v2/referrals/ambassador/apply').send({ college: 'NIT Trichy' });
        expect(r.status).toBe(403);
        expect(r.body).toMatchObject({ success: false, code: 'not_yet', message: 'You can apply at 10 paying friends. You have 3.' });
    });

    it('an application at 10 goes through with the college the student typed', async () => {
        const { app, calls } = mount();
        const r = await request(app).post('/api/v2/referrals/ambassador/apply').send({ college: 'NIT Trichy' });
        expect(r.status).toBe(200);
        expect(r.body).toMatchObject({ success: true, status: 'applied', college: 'NIT Trichy' });
        expect(calls.applied).toEqual([{ college: 'NIT Trichy' }]);
    });
});

describe('/api/admin-internal/referrals (the admin)', () => {
    function mount({ admin = true, ...over } = {}) {
        jest.resetModules();
        const calls = { summarized: [], applied: [], decided: [], frozen: [], settled: 0, audit: [] };
        jest.doMock('../../middleware/adminAuth', () => ({
            requireAdminAPI: (req, res, next) => {
                if (!admin) return res.status(401).json({ error: 'Admin sign-in required' });
                req.session = { adminUser: { username: 'tenadmin' } };
                next();
            },
            verifyAdminCredentials: async () => false,
            ADMIN_USERNAME: 'tenadmin'
        }));
        jest.doMock('../../models/AuditLog', () => ({ create: async (row) => { calls.audit.push(row); return row; } }));
        jest.doMock('../../services/referrals', () => fakeService(calls, over));
        const app = express();
        app.use(express.json());
        app.use('/', require('../../routes/adminPortal'));
        return { app, calls };
    }
    const ID = '65a0000000000000000000ff';

    it('is closed without an admin session', async () => {
        const { app } = mount({ admin: false });
        for (const [method, route] of [['get', '/referrals'], ['post', '/referrals/settle'],
            ['post', `/referrals/ambassadors/${ID}/approve`], ['post', `/referrals/freeze/${ID}`]]) {
            expect((await request(app)[method](route)).status).toBe(401);
        }
    });

    it('shows the overview and settles on demand', async () => {
        const { app, calls } = mount();
        expect((await request(app).get('/referrals')).body).toMatchObject({ success: true, totals: { referrers: 1 } });
        expect((await request(app).post('/referrals/settle')).body).toMatchObject({ success: true, created: 2 });
        expect(calls.settled).toBe(1);
    });

    it('decides an application as the signed-in admin, and logs it', async () => {
        const { app, calls } = mount();
        const r = await request(app).post(`/referrals/ambassadors/${ID}/reject`).send({ note: 'Please apply with your college ID' });
        expect(r.status).toBe(200);
        expect(calls.decided).toEqual([{ id: ID, action: 'reject', admin: 'tenadmin', note: 'Please apply with your college ID' }]);
        expect(calls.audit[0]).toMatchObject({ userId: ID, actionType: 'ambassador_reject', performedBy: 'admin' });
    });

    it('a second ambassador for one college is refused with the reason', async () => {
        const r = await request(mount({ collegeTaken: true }).app).post(`/referrals/ambassadors/${ID}/approve`);
        expect(r.status).toBe(409);
        expect(r.body).toMatchObject({ success: false, code: 'college_taken' });
    });

    it('freezes and unfreezes a referrer, and logs both', async () => {
        const { app, calls } = mount();
        await request(app).post(`/referrals/freeze/${ID}`).send({ frozen: true });
        await request(app).post(`/referrals/freeze/${ID}`).send({ frozen: false });
        expect(calls.frozen).toEqual([{ id: ID, frozen: true }, { id: ID, frozen: false }]);
        expect(calls.audit.map((a) => a.actionType)).toEqual(['referral_frozen', 'referral_unfrozen']);
    });

    it('refuses an id that is not one', async () => {
        const { app, calls } = mount();
        expect((await request(app).post('/referrals/freeze/not-an-id').send({ frozen: true })).status).toBe(400);
        expect((await request(app).post('/referrals/ambassadors/$where/approve')).status).toBe(400);
        expect(calls.frozen).toEqual([]);
    });
});

describe('the sign-up report counts students\' links as one row', () => {
    it('stu-* is every student\'s own link together', async () => {
        jest.resetModules();
        jest.doMock('../../models/Student', () => ({
            find: () => ({ select: () => ({ lean: async () => [
                { signupRef: 'stu-abc2345' }, { signupRef: 'stu-k7m2qxa' }, { signupRef: 'li-post-1' }, { signupRef: 'stu-abc2345' }, {}
            ] }) })
        }));
        const { api } = require('../../routes/growth');
        const app = express();
        app.use((req, _res, next) => { req.session = { growthUser: { username: 'growth', lastActivity: Date.now() } }; next(); });
        app.use('/api/growth', api);
        const r = await request(app).get('/api/growth/signup-sources?days=7');
        expect(r.body).toMatchObject({ signups: 5, sources: [{ ref: 'stu-*', signups: 3 }, { ref: 'li-post-1', signups: 1 }] });
    });
});

describe('Refer & Earn is reachable from the portal', () => {
    const server = read('server.js');

    it('the server mounts the API and serves /refer', () => {
        expect(server).toContain("app.use('/api/v2/referrals', require('./routes/v2/referrals'))");
        expect(server).toContain('app.get("/refer", (req,res)=>{ res.sendFile(path.join(__dirname,"public","refer.html")); });');
    });

    it('the reward sweep starts only where the other scheduled jobs do (worker 0)', () => {
        const start = server.indexOf('require("./services/automationCron").initAutomation();');
        const sweep = server.indexOf('require("./services/referrals").startSweep();');
        const branchEnd = server.indexOf('// The idea agent.', start);
        expect(start).toBeGreaterThan(-1);
        expect(sweep).toBeGreaterThan(start);
        expect(sweep).toBeLessThan(branchEnd);
    });

    it('the dashboard has it in the menu and as a card', () => {
        const dash = read('public/student-dashboard.html');
        expect(dash.match(/window\.location\.href='\/refer'/g)).toHaveLength(2);
    });

    it('the page reads the signed-in student\'s data and escapes what friends typed', () => {
        const page = read('public/refer.html');
        expect(page).toContain('<script src="/session-guard.js"></script>');
        expect(page).toContain("fetch('/api/v2/referrals/me', { credentials: 'same-origin' })");
        expect(page).toContain('esc(f.name)');
        expect(page).toContain('esc(h.friend)');
        expect(page).toContain('esc(a.college)');
    });

    it('the admin portal has the section', () => {
        const admin = read('public/ten-admin.html');
        expect(admin).toContain("showSection('referrals')");
        expect(admin).toContain('id="section-referrals"');
        expect(admin).toContain("api('/referrals')");
    });

    describe('the sign-up page tells a friend what they get', () => {
        const page = read('public/register.html');
        const snippet = page.slice(page.indexOf('<p id="friendLinkNote"'), page.indexOf('</script>', page.indexOf('<p id="friendLinkNote"')));
        const script = snippet.slice(snippet.indexOf('<script>') + '<script>'.length);

        function shown(ref) {
            const note = { style: { display: 'none' } };
            vm.runInNewContext(script, { window: { tenSignupRef: () => ref }, document: { getElementById: () => note } });
            return note.style.display;
        }

        it.each([['stu-abc2345', 'block'], ['li-2026-12-01-webdev', 'none'], ['', 'none']])('ref %p → %s', (ref, display) => {
            expect(shown(ref)).toBe(display);
        });

        it('promises only what the rules give', () => {
            expect(snippet).toContain('100 coins when you finish week 1, and 200 more when your first payment is approved');
        });
    });
});
