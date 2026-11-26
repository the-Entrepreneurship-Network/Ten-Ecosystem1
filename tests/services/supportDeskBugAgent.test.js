'use strict';

/**
 * Who handles students' reports of website problems, and whether Claude is
 * answering (services/supportDesk/bugAgent.js).
 *
 * What must hold: one alert when Claude stops responding and one when it is
 * back, never a stream of them; the wake call carries the task's token; a
 * quiet Claude is only judged while it is the one handling reports; and
 * Gemini's answer is used only when it is usable.
 */

function load({ geminiReady = true, ask } = {}) {
    jest.resetModules();
    let doc = null;
    jest.doMock('../../models/SupportDeskState', () => ({
        findById: jest.fn(() => ({ lean: async () => (doc ? Object.assign({}, doc) : null) })),
        findByIdAndUpdate: jest.fn((id, { $set }) => ({
            lean: async () => {
                doc = Object.assign({ _id: id, engine: 'claude' }, doc || {}, $set);
                return Object.assign({}, doc);
            }
        }))
    }));
    jest.doMock('../../utils/gemini', () => ({
        ready: () => geminiReady,
        ask: ask || jest.fn(),
        Type: { OBJECT: 'OBJECT', STRING: 'STRING' }
    }));
    return { bugAgent: require('../../services/supportDesk/bugAgent'), doc: () => doc };
}

/** The API trigger, answering `status`. */
function fakeFire(status) {
    const https = require('https');
    const { EventEmitter } = require('events');
    const calls = [];
    const spy = jest.spyOn(https, 'request').mockImplementation((url, opts, cb) => {
        const call = { url, opts };
        calls.push(call);
        const req = new EventEmitter();
        req.destroy = () => {};
        req.end = (body) => {
            call.body = body;
            const res = new EventEmitter();
            res.statusCode = status;
            res.resume = () => {};
            cb(res);
            res.emit('end');
        };
        return req;
    });
    return { calls, restore: () => spy.mockRestore() };
}

const T0 = new Date('2026-11-25T10:00:00Z');
const later = (minutes) => new Date(T0.getTime() + minutes * 60000);
const ask = { subject: 'task journey', body: 'not working', known: '', portalUrl: 'https://portal.test' };

beforeEach(() => {
    process.env.BUG_AGENT_FIRE_URL = 'https://api.anthropic.com/v1/claude_code/routines/trig_test/fire';
    process.env.BUG_AGENT_TOKEN = 'sk-ant-oat01-test';
});
afterEach(() => {
    delete process.env.BUG_AGENT_FIRE_URL;
    delete process.env.BUG_AGENT_TOKEN;
});

test('waking calls the API trigger with the token, then waits for a check-in', async () => {
    const { bugAgent, doc } = load();
    const fire = fakeFire(200);
    try {
        expect(await bugAgent.wake(jest.fn(), T0)).toBe('woken');
    } finally {
        fire.restore();
    }
    expect(fire.calls[0].url).toBe('https://api.anthropic.com/v1/claude_code/routines/trig_test/fire');
    expect(fire.calls[0].opts.method).toBe('POST');
    expect(fire.calls[0].opts.headers).toEqual(expect.objectContaining({
        Authorization: 'Bearer sk-ant-oat01-test',
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json'
    }));
    expect(JSON.parse(fire.calls[0].body).text).toMatch(/website problem/);
    expect(doc().awaitingSince).toEqual(T0);
});

test('without its URL and token nothing is called', async () => {
    delete process.env.BUG_AGENT_TOKEN;
    const { bugAgent } = load();
    expect(await bugAgent.wake(jest.fn(), T0)).toBe('not set up');
});

test('one alert when waking fails, one when Claude checks in again, never a stream', async () => {
    const { bugAgent, doc } = load();
    const notify = jest.fn(async () => {});
    const quiet = jest.spyOn(console, 'error').mockImplementation(() => {});
    const fire = fakeFire(401);
    try {
        expect(await bugAgent.wake(notify, T0)).toBe('failed');
        await bugAgent.wake(notify, later(5));
    } finally {
        fire.restore();
        quiet.mockRestore();
    }
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify.mock.calls[0][0]).toMatch(/not responding/);
    expect(notify.mock.calls[0][1]).toMatch(/HTTP 401/);
    expect(notify.mock.calls[0][1]).toMatch(/Gemini \(free\)/);
    expect(doc()).toEqual(expect.objectContaining({ down: true, downReason: expect.stringMatching(/401/) }));

    await bugAgent.heartbeat(later(60), notify);
    expect(notify).toHaveBeenCalledTimes(2);
    expect(notify.mock.calls[1][0]).toMatch(/working again/);
    expect(doc().down).toBe(false);
    await bugAgent.heartbeat(later(70), notify);
    expect(notify).toHaveBeenCalledTimes(2);
});

test('woken and silent for 30 minutes is not responding; a check-in in time is fine', async () => {
    const notify = jest.fn(async () => {});
    let { bugAgent, doc } = load();
    let fire = fakeFire(200);
    try { await bugAgent.wake(notify, T0); } finally { fire.restore(); }
    await bugAgent.check(notify, later(20));
    await bugAgent.heartbeat(later(25), notify);
    await bugAgent.check(notify, later(90));
    expect(doc().down).toBeFalsy();
    expect(notify).not.toHaveBeenCalled();

    ({ bugAgent, doc } = load());
    fire = fakeFire(200);
    try { await bugAgent.wake(notify, T0); } finally { fire.restore(); }
    await bugAgent.check(notify, later(31));
    expect(doc().down).toBe(true);
    expect(notify).toHaveBeenCalledTimes(1);
});

test('13 hours with no check-in is not responding, but only while Claude handles reports', async () => {
    const { bugAgent, doc } = load();
    const notify = jest.fn(async () => {});
    await bugAgent.heartbeat(T0, notify);
    await bugAgent.setEngine('gemini');
    await bugAgent.check(notify, later(14 * 60));
    expect(doc().down).toBeFalsy();
    await bugAgent.setEngine('claude');
    await bugAgent.check(notify, later(14 * 60));
    expect(doc().down).toBe(true);
    expect(notify).toHaveBeenCalledTimes(1);
});

test('the switch takes only Claude, Gemini or Off', async () => {
    const { bugAgent } = load();
    await expect(bugAgent.setEngine('openai')).rejects.toThrow(/Claude, Gemini or Off/);
    expect((await bugAgent.setEngine('off')).engine).toBe('off');
    expect((await bugAgent.summary()).claudeReady).toBe(true);
});

test('Gemini\'s reply is used only when it is usable', async () => {
    let { bugAgent } = load({ ask: jest.fn(async () => ({ kind: 'not-a-bug', reply: '  Week 2 opens once Week 1 is approved.  ' })) });
    expect(await bugAgent.geminiReply(ask)).toEqual({ kind: 'not-a-bug', reply: 'Week 2 opens once Week 1 is approved.' });

    ({ bugAgent } = load({ ask: jest.fn(async () => ({ kind: 'something else', reply: 'We are looking into it.' })) }));
    expect((await bugAgent.geminiReply(ask)).kind).toBe('bug');

    ({ bugAgent } = load({ ask: jest.fn(async () => ({ kind: 'bug', reply: '   ' })) }));
    expect(await bugAgent.geminiReply(ask)).toBeNull();

    ({ bugAgent } = load({ geminiReady: false }));
    expect(await bugAgent.geminiReply(ask)).toBeNull();
});

test('the check on a saved answer: fixes, does not fix, or no verdict', async () => {
    const check = { subject: 'Task upload', body: 'File is too large, but my files are under 25MB', answer: 'How to submit a task: open Task Journey.' };
    const ask = jest.fn(async () => ({ verdict: 'fixes' }));
    let { bugAgent } = load({ ask });
    expect(await bugAgent.answerFits(check)).toBe(true);
    expect(ask.mock.calls[0][0]).toContain('The saved answer:\nHow to submit a task: open Task Journey.');
    expect(ask.mock.calls[0][0]).toContain('File is too large, but my files are under 25MB');

    ({ bugAgent } = load({ ask: jest.fn(async () => ({ verdict: ' Does-Not-Fix ' })) }));
    expect(await bugAgent.answerFits(check)).toBe(false);

    ({ bugAgent } = load({ ask: jest.fn(async () => ({ verdict: 'maybe' })) }));
    expect(await bugAgent.answerFits(check)).toBeNull();

    ({ bugAgent } = load({ geminiReady: false }));
    expect(await bugAgent.answerFits(check)).toBeNull();
});
