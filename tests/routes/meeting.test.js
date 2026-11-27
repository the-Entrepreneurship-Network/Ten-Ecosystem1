'use strict';

/**
 * @jest-environment node
 *
 * /api/v2/meeting (routes/v2/meeting.js): only a signed-in student, only when
 * the AI Coordinator is on, and the answers pass straight through.
 */

jest.mock('../../services/aiMeeting', () => ({
    QUESTIONS: 5,
    ask: jest.fn(async ({ text }) => ({ reply: 'Reply to ' + text, source: 'saved', handover: false })),
    startInterview: jest.fn(async () => ({ sessionId: 's1', question: 'Q1', number: 1, of: 5 })),
    answerInterview: jest.fn(async ({ answer }) => (answer === 'busy' ? { error: 'The AI is busy right now. Try again in a minute, or message your coordinator in Messages.' }
        : answer === '' ? { error: 'Say or type your answer first.' } : { score: 7, feedback: 'ok', question: 'Q2', number: 2, of: 5, done: false, report: null })),
    finishInterview: jest.fn(async () => ({ report: { overall: 7 } })),
    reports: jest.fn(async () => [{ id: 's0', overall: 6 }]),
    _internal: { BUSY: 'The AI is busy right now. Try again in a minute, or message your coordinator in Messages.' }
}));
jest.mock('../../services/aiCoordinator', () => ({ NAME: 'TEN AI Coordinator', enabled: () => !/^off$/i.test(process.env.AI_COORDINATOR || '') }));

const router = require('../../routes/v2/meeting');
const { requireStudent } = require('../../middleware/sessionAuth');

const student = { _id: 'stu1', employeeId: 'TEN/WEB/1005', name: 'Priya', domain: 'Web Development' };
function handler(method, path) {
    const layer = router.stack.find((l) => l.route && l.route.path === path && l.route.methods[method]);
    const h = layer.route.stack;
    return h[h.length - 1].handle;
}
async function call(method, path, body) {
    let status = 200; let out;
    const res = { status(c) { status = c; return this; }, json(b) { out = b; return this; } };
    await handler(method, path)({ student, body: body || {}, query: {}, params: {} }, res);
    return { status, body: out };
}

afterEach(() => { delete process.env.AI_COORDINATOR; });

describe('/api/v2/meeting', () => {
    it('every route sits behind the student session guard', () => {
        expect(router.stack[0].handle).toBe(requireStudent);
    });

    it('says who is here and lists the reports', async () => {
        const { body } = await call('get', '/');
        expect(body).toMatchObject({ success: true, enabled: true, name: 'Priya', domain: 'Web Development', assistant: 'TEN AI Coordinator', questions: 5, reports: [{ id: 's0', overall: 6 }] });
    });

    it('answers a question, and refuses an empty or endless one', async () => {
        expect((await call('post', '/ask', { text: 'hi' })).body).toEqual({ success: true, reply: 'Reply to hi', source: 'saved', handover: false });
        expect((await call('post', '/ask', { text: '  ' })).status).toBe(400);
        expect((await call('post', '/ask', { text: 'x'.repeat(2001) })).status).toBe(400);
    });

    it('runs the interview, with the service\'s own messages on a refusal', async () => {
        expect((await call('post', '/interview/start')).body).toMatchObject({ success: true, sessionId: 's1', question: 'Q1' });
        expect((await call('post', '/interview/answer', { sessionId: 's1', answer: 'An API.' })).body).toMatchObject({ success: true, score: 7, question: 'Q2' });
        expect(await call('post', '/interview/answer', { sessionId: 's1', answer: '' })).toEqual({ status: 400, body: { success: false, message: 'Say or type your answer first.' } });
        expect((await call('post', '/interview/answer', { sessionId: 's1', answer: 'busy' })).status).toBe(503);
        expect((await call('post', '/interview/finish', { sessionId: 's1' })).body).toEqual({ success: true, report: { overall: 7 } });
    });

    it('is switched off with the AI Coordinator', async () => {
        process.env.AI_COORDINATOR = 'off';
        expect((await call('post', '/ask', { text: 'hi' })).status).toBe(503);
        expect((await call('post', '/interview/start')).status).toBe(503);
        expect((await call('get', '/')).body).toMatchObject({ enabled: false, reports: [] });
    });
});
