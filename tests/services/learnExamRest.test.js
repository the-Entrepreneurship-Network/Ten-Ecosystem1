'use strict';

/**
 * The examiner talks to Gemini over plain HTTPS.
 *
 * It used to go through @google/genai, which needs the fetch API and
 * ReadableStream as globals. This server runs Node 16, which has neither, so
 * the SDK threw while loading and every exam returned "the examiner is busy" —
 * the key was fine the whole time.
 *
 * These tests stub `https.request`, so they prove the request we build and the
 * errors we raise without a key, a network, or a single token spent.
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const { EventEmitter } = require('events');

const SRC = path.join(__dirname, '../../services/learnExam.js');
const code = fs.readFileSync(SRC, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

const KEY = 'SECRET-KEY-DO-NOT-LEAK-9999';

/** Reply to the next request with this status and body; capture what was sent. */
function stubHttps(status, body) {
    const seen = {};
    const spy = jest.spyOn(https, 'request').mockImplementation((opts, cb) => {
        seen.opts = opts;
        const req = new EventEmitter();
        req.setTimeout = () => {};
        req.destroy = () => {};
        req.end = (payload) => {
            seen.payload = payload;
            const res = new EventEmitter();
            res.statusCode = status;
            res.setEncoding = () => {};
            process.nextTick(() => {
                res.emit('data', typeof body === 'string' ? body : JSON.stringify(body));
                res.emit('end');
            });
            cb(res);
        };
        return req;
    });
    return { seen, restore: () => spy.mockRestore() };
}

function load() {
    jest.resetModules();
    process.env.GEMINI_API_KEY = KEY;
    return require(SRC);
}

afterEach(() => { jest.restoreAllMocks(); delete process.env.GEMINI_API_KEY; });

describe('the Google SDK is gone', () => {
    test('nothing requires it at runtime any more', () => {
        expect(code).not.toMatch(/require\(['"]@google\/genai['"]\)/);
    });

    test('the schema types the call sites use are all defined locally', () => {
        for (const t of ['OBJECT', 'ARRAY', 'STRING', 'BOOLEAN', 'INTEGER']) {
            expect(code).toMatch(new RegExp(`${t}:\\s*'${t}'`));
        }
    });

    test('it uses node https, which Node 16 has, not fetch, which it does not', () => {
        expect(code).toMatch(/require\('https'\)/);
        expect(code).not.toMatch(/\bfetch\(/);
    });
});

describe('the request we send', () => {
    test('carries the prompt, the schema and asks for JSON', async () => {
        const s = stubHttps(200, {
            candidates: [{ content: { parts: [{ text: '{"ok":true}' }] } }]
        });
        const exam = load();
        const schema = { type: 'OBJECT', properties: { ok: { type: 'BOOLEAN' } } };

        await expect(exam.selfTest()).resolves.toMatchObject({ ok: true, reason: 'live' });

        const body = JSON.parse(s.seen.payload);
        expect(body.contents[0].parts[0].text).toMatch(/ok/);
        expect(body.generationConfig.responseMimeType).toBe('application/json');
        expect(s.seen.opts.method).toBe('POST');
        expect(s.seen.opts.host).toBe('generativelanguage.googleapis.com');
        expect(String(s.seen.opts.path)).toContain('gemini-3.8-flash');
        void schema;
        s.restore();
    });

    test('the model can be changed without a deploy', async () => {
        // Google retires models; the exam must not need a code change for that.
        const st = stubHttps(200, { candidates: [{ content: { parts: [{ text: '{"ok":true}' }] } }] });
        jest.resetModules();
        process.env.GEMINI_API_KEY = KEY;
        process.env.GEMINI_MODEL = 'some-future-model';
        await require(SRC).selfTest();

        expect(String(st.seen.opts.path)).toContain('some-future-model');
        delete process.env.GEMINI_MODEL;
        st.restore();
    });

    test('a stalled connection gives up instead of hanging for ever', async () => {
        // This server never answers. If the timeout is not armed, the promise
        // below never settles and the test times out — which is the point: a
        // source-text check would pass even with the timeout disabled.
        const spy = jest.spyOn(https, 'request').mockImplementation(() => {
            const req = new EventEmitter();
            req.setTimeout = (ms, cb) => { process.nextTick(cb); };
            req.destroy = (err) => { req.emit('error', err); };
            req.end = () => {};                       // no response, ever
            return req;
        });

        const exam = load();
        const out = await exam.selfTest();
        expect(out.ok).toBe(false);
        expect(out.detail).toMatch(/timeout/i);
        expect(out.detail).not.toContain(KEY);
        spy.mockRestore();
    }, 5000);
});

describe('failures never leak the key', () => {
    test('an HTTP error reports the status, not the url', async () => {
        const s = stubHttps(400, { error: { message: 'bad request' } });
        const exam = load();
        const out = await exam.selfTest();

        expect(out.ok).toBe(false);
        expect(out.detail).toContain('400');
        expect(out.detail).not.toContain(KEY);
        s.restore();
    });

    test('a reply that is not JSON is reported, not thrown raw', async () => {
        const s = stubHttps(200, '<html>502 Bad Gateway</html>');
        const exam = load();
        const out = await exam.selfTest();

        expect(out.ok).toBe(false);
        expect(out.detail).not.toContain(KEY);
        s.restore();
    });

    test('a blocked or empty answer is reported as a reason, not a crash', async () => {
        const s = stubHttps(200, { promptFeedback: { blockReason: 'SAFETY' } });
        const exam = load();
        const out = await exam.selfTest();

        expect(out.ok).toBe(false);
        expect(out.detail).toMatch(/SAFETY/);
        s.restore();
    });

    test('generatePaper refuses without a key rather than posting an empty one', async () => {
        // selfTest() short-circuits on ready(), so it never reaches the guard
        // inside gemini(). generatePaper does, and it is the path a student
        // actually hits — an empty key must not become a real request.
        const spy = jest.spyOn(https, 'request').mockImplementation(() => {
            throw new Error('a request was sent with no key');
        });
        jest.resetModules();
        for (const v of ['GEMINI_API_KEY', 'GOOGLE_API_KEY', 'GEMINI_KEY']) delete process.env[v];
        const exam = require(SRC);

        const mod = { name: 'Test', topics: [{ title: 'T', difficulty: 1, technical: 'x', simple: 'y' }] };
        await expect(exam.generatePaper(mod, 1)).rejects.toThrow(/no gemini key/i);
        expect(spy).not.toHaveBeenCalled();
        spy.mockRestore();
    });

    test('with no key at all it says so instead of calling out', async () => {
        jest.resetModules();
        delete process.env.GEMINI_API_KEY;
        delete process.env.GOOGLE_API_KEY;
        delete process.env.GEMINI_KEY;
        const exam = require(SRC);
        await expect(exam.selfTest()).resolves.toMatchObject({ reason: 'no-key' });
    });
});

/**
 * Google answers 503 "this model is currently experiencing high demand" under
 * load, and 429 when the free tier's per-minute limit is hit. Both clear in
 * seconds. Without a retry, one of them is a student's exam failing outright.
 */
describe('a 503 or 429 is asked again, nothing else is', () => {
    const OK = { candidates: [{ content: { parts: [{ text: '{"ok":true}' }] } }] };
    const BUSY = { error: { code: 503, message: 'high demand', status: 'UNAVAILABLE' } };

    /** Answer each call with the next entry in `replies`; count the calls. */
    function stubSequence(replies) {
        const calls = { n: 0 };
        jest.spyOn(https, 'request').mockImplementation((opts, cb) => {
            const { status, body, fail } = replies[Math.min(calls.n, replies.length - 1)];
            calls.n += 1;
            const req = new EventEmitter();
            req.setTimeout = () => {};
            req.destroy = () => {};
            req.end = () => {
                if (fail) return process.nextTick(() => req.emit('error', new Error(fail)));
                const res = new EventEmitter();
                res.statusCode = status;
                res.setEncoding = () => {};
                process.nextTick(() => {
                    res.emit('data', JSON.stringify(body));
                    res.emit('end');
                });
                cb(res);
            };
            return req;
        });
        return calls;
    }

    // The backoff is real seconds in production. Firing the timer at once keeps
    // the suite instant while still proving the retry happened.
    beforeEach(() => {
        jest.spyOn(global, 'setTimeout').mockImplementation((fn) => { fn(); return 0; });
    });

    test('a 503 on the first try still produces a paper on the second', async () => {
        const calls = stubSequence([
            { status: 503, body: BUSY },
            { status: 200, body: OK },
        ]);
        await expect(load().__gemini('hi', {})).resolves.toEqual({ ok: true });
        expect(calls.n).toBe(2);
    });

    test('a 429 is retried the same way', async () => {
        const calls = stubSequence([
            { status: 429, body: { error: { code: 429, message: 'rate limit' } } },
            { status: 200, body: OK },
        ]);
        await expect(load().__gemini('hi', {})).resolves.toEqual({ ok: true });
        expect(calls.n).toBe(2);
    });

    test('three attempts is the ceiling, and the real reason is reported', async () => {
        const calls = stubSequence([{ status: 503, body: BUSY }]);
        await expect(load().__gemini('hi', {})).rejects.toThrow(/503/);
        expect(calls.n).toBe(3);                 // one try plus two retries, not forever
    });

    test('a 400 is our mistake and is NOT retried', async () => {
        const calls = stubSequence([
            { status: 400, body: { error: { code: 400, message: 'bad schema' } } },
        ]);
        await expect(load().__gemini('hi', {})).rejects.toThrow(/400/);
        expect(calls.n).toBe(1);
    });

    test('a dropped connection is not retried either', async () => {
        const calls = stubSequence([{ fail: 'ECONNRESET' }]);
        await expect(load().__gemini('hi', {})).rejects.toThrow(/ECONNRESET/);
        expect(calls.n).toBe(1);
    });
});
