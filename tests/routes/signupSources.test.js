'use strict';

/**
 * @jest-environment node
 *
 * Which link brought a sign-up (?ref=…), and how many came through each.
 *
 *   public/ref.js        keeps the ref for 30 days, on /, /overview and /register
 *   register.html        sends it with the form
 *   the controller       stores it on the student, cleaned (utils/signupRef.js)
 *   GET /api/growth/signup-sources   counts sign-ups per ref
 *   the college letter   links with ref=college-<domain>
 *
 * The marketing agent reads the counts with SIGNUP_SOURCES_KEY. That key must
 * open this one read-only route and nothing else in Growth OS.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const express = require('express');
const request = require('supertest');

const root = path.join(__dirname, '../..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const { cleanSignupRef, SIGNUP_REF } = require('../../utils/signupRef');

describe('a ref is a label TEN chose, nothing else', () => {
    it.each([
        ['li-2026-12-01-webdev', 'li-2026-12-01-webdev'],
        ['  College-IITB.ac.in ', 'college-iitb.ac.in'],
        ['ig_reel.7', 'ig_reel.7']
    ])('%p is kept as %p', (value, kept) => expect(cleanSignupRef(value)).toBe(kept));

    it.each(['', null, undefined, '<script>', 'a b', '-starts-with-a-dash', 'x'.repeat(65), 'a&b=c'])(
        '%p is dropped', (value) => expect(cleanSignupRef(value)).toBeUndefined());

    it('the page checks it with the same pattern', () => {
        expect(read('public/ref.js')).toContain(SIGNUP_REF.source);
    });
});

/** Run public/ref.js as a browser would, with this address and this storage. */
function visit(search, store, now, { storageBlocked = false } = {}) {
    const localStorage = {
        getItem: (k) => { if (storageBlocked) throw new Error('blocked'); return k in store ? store[k] : null; },
        setItem: (k, v) => { if (storageBlocked) throw new Error('blocked'); store[k] = String(v); }
    };
    const page = { location: { search }, localStorage, URLSearchParams, JSON, Date: { now: () => now } };
    page.window = page;
    vm.runInNewContext(read('public/ref.js'), page);
    return page.tenSignupRef();
}

describe('the browser keeps the ref until the student registers', () => {
    const DAY = 24 * 60 * 60 * 1000;
    const T0 = Date.UTC(2026, 10, 27);

    it('for 30 days after the link, then forgets it', () => {
        const store = {};
        expect(visit('?ref=LI-Post-1', store, T0)).toBe('li-post-1');
        expect(visit('', store, T0 + 29 * DAY)).toBe('li-post-1');
        expect(visit('', store, T0 + 31 * DAY)).toBe('');
    });

    it('a newer link takes over, and junk in the address bar changes nothing', () => {
        const store = {};
        visit('?ref=li-post-1', store, T0);
        expect(visit('?ref=<script>', store, T0 + DAY)).toBe('li-post-1');
        expect(visit('?ref=college-nitt.edu', store, T0 + DAY)).toBe('college-nitt.edu');
    });

    it('with storage blocked, the ref in the address still counts', () => {
        expect(visit('?ref=wa-group', {}, T0, { storageBlocked: true })).toBe('wa-group');
    });
});

describe('the ref travels from the link to the student record', () => {
    it.each(['public/index.html', 'public/overview.html', 'public/register.html'])('%s keeps it', (f) => {
        expect(read(f)).toContain('<script src="/ref.js"');
    });

    it('the form sends it with the registration', () => {
        const page = read('public/register.html');
        const at = page.indexOf('payload.ref = window.tenSignupRef');
        expect(at).toBeGreaterThan(-1);
        expect(at).toBeLessThan(page.indexOf('fetch("/api/register-hub/register"'));
    });

    it('the registration stores it on the student, cleaned', () => {
        const code = read('controllers/registerHubController.js');
        const create = code.slice(code.indexOf('const legacyStudent = await Student.create('));
        expect(create.slice(0, create.indexOf('});'))).toContain('signupRef: cleanSignupRef(req.body.ref)');
    });

    it('the student model has the field, so Mongoose does not drop it', () => {
        expect(require('../../models/Student').schema.path('signupRef')).toBeTruthy();
    });
});

describe('GET /api/growth/signup-sources', () => {
    const KEY = 'a-long-random-key-for-tests-0123456789';
    const OLD_KEY = process.env.SIGNUP_SOURCES_KEY;
    afterEach(() => {
        if (OLD_KEY === undefined) delete process.env.SIGNUP_SOURCES_KEY; else process.env.SIGNUP_SOURCES_KEY = OLD_KEY;
    });

    function mount({ students = [], signedIn = false } = {}) {
        jest.resetModules();
        const seen = { query: null };
        jest.doMock('../../models/Student', () => ({
            find: (q) => { seen.query = q; return { select: () => ({ lean: async () => students }) }; }
        }));
        const { api } = require('../../routes/growth');
        const app = express();
        app.use(express.json());
        app.use((req, _res, next) => {
            req.session = signedIn ? { growthUser: { username: 'growth', lastActivity: Date.now() } } : {};
            next();
        });
        app.use('/api/growth', api);
        return { app, seen };
    }

    it('counts sign-ups per ref, most first, for a Growth OS user', async () => {
        const { app, seen } = mount({
            signedIn: true,
            students: [{ signupRef: 'li-post-1' }, { signupRef: 'college-nitt.edu' }, { signupRef: 'li-post-1' }, {}]
        });
        const r = await request(app).get('/api/growth/signup-sources?days=7');
        expect(r.status).toBe(200);
        expect(r.body).toMatchObject({
            success: true, days: 7, signups: 4,
            sources: [{ ref: 'li-post-1', signups: 2 }, { ref: 'college-nitt.edu', signups: 1 }]
        });
        const since = seen.query.createdAt.$gte.getTime();
        expect(Math.abs(Date.now() - 7 * 24 * 60 * 60 * 1000 - since)).toBeLessThan(60 * 1000);
    });

    it('the agent reads it with the key', async () => {
        process.env.SIGNUP_SOURCES_KEY = KEY;
        const { app } = mount({ students: [{ signupRef: 'ig-reel-3' }] });
        const r = await request(app).get('/api/growth/signup-sources').set('Authorization', 'Bearer ' + KEY);
        expect(r.status).toBe(200);
        expect(r.body.sources).toEqual([{ ref: 'ig-reel-3', signups: 1 }]);
    });

    it.each([['no key', null], ['a wrong key', 'Bearer ' + 'x'.repeat(38)], ['the key without "Bearer"', 'nope']])(
        'refuses %s', async (_what, header) => {
            process.env.SIGNUP_SOURCES_KEY = KEY;
            const { app } = mount();
            const req = request(app).get('/api/growth/signup-sources');
            const r = await (header ? req.set('Authorization', header) : req);
            expect(r.status).toBe(401);
        });

    it('a key shorter than 24 characters is never accepted', async () => {
        process.env.SIGNUP_SOURCES_KEY = 'short-key';
        const { app } = mount();
        const r = await request(app).get('/api/growth/signup-sources').set('Authorization', 'Bearer short-key');
        expect(r.status).toBe(401);
    });

    it('the key opens nothing else in Growth OS', async () => {
        process.env.SIGNUP_SOURCES_KEY = KEY;
        const { app } = mount();
        const r = await request(app).get('/api/growth/campaigns').set('Authorization', 'Bearer ' + KEY);
        expect(r.status).toBe(401);
    });
});

describe('the college letter is counted to its college', () => {
    const { refFor, buildHtml } = require('../../services/collegeOutreach');

    it.each([
        [{ website: 'https://www.iitb.ac.in/placement', email: 'tpo@iitb.ac.in' }, 'college-iitb.ac.in'],
        [{ website: 'nitt.edu', email: 'x@nitt.edu' }, 'college-nitt.edu'],
        [{ website: '', email: 'cell@college.edu.in' }, 'college-college.edu.in'],
        [{ email: '' }, 'college-letter']
    ])('%j → %s', (contact, ref) => expect(refFor(contact)).toBe(ref));

    it('the letter links with it', () => {
        expect(buildHtml({ email: 'tpo@iitb.ac.in', website: 'https://www.iitb.ac.in', college: 'IIT Bombay' }))
            .toContain('/overview?ref=college-iitb.ac.in');
    });
});
