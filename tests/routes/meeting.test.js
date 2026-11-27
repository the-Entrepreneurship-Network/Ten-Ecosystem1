'use strict';

/**
 * @jest-environment node
 *
 * /api/v2/meeting (routes/v2/meeting.js): only a signed-in student, only when
 * the AI Coordinator is on, 403 outside the opening, and the answers pass
 * straight through.
 */

const BUSY = 'The AI is busy right now. Try again in a minute; your interview continues where it stopped.';
jest.mock('../../services/aiMeeting', () => ({
    QUESTIONS: 8,
    schedule: jest.fn(() => ({ open: false, today: '2026-12-14', next: '2026-12-27', following: '2027-01-10' })),
    status: jest.fn(async () => ({ schedule: { open: true, today: '2026-12-13', next: '2026-12-13', following: '2026-12-27', nextLabel: 'Sunday, 13 December 2026', followingLabel: 'Sunday, 27 December 2026' }, state: 'open', sessionId: null, reports: [{ id: 's0', overall: 6 }] })),
    LEVELS: ['easy', 'medium', 'hard'],
    startInterview: jest.fn(async ({ student, difficulty }) => (student.domain === 'closed' ? { error: 'The interview opens every second Sunday. Next: Sunday, 27 December 2026 (IST).', closed: true } : { sessionId: 's1', question: 'Q1', number: 1, of: 8, difficulty })),
    answerInterview: jest.fn(async ({ answer, seconds, proctor }) => (answer === 'busy' ? { error: BUSY }
        : answer === '' ? { error: 'Say or type your answer first.' } : { score: 7, feedback: 'ok', question: 'Q2', number: 2, of: 8, done: false, report: null, got: { seconds, proctor } })),
    finishInterview: jest.fn(async () => ({ report: { overall: 7 } })),
    _internal: { BUSY }
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
async function call(method, path, body, who = student) {
    let status = 200; let out;
    const res = { status(c) { status = c; return this; }, json(b) { out = b; return this; } };
    await handler(method, path)({ student: who, body: body || {}, query: {}, params: {} }, res);
    return { status, body: out };
}

afterEach(() => { delete process.env.AI_COORDINATOR; });

describe('/api/v2/meeting', () => {
    it('every route sits behind the student session guard, and there is no free-form question route', () => {
        expect(router.stack[0].handle).toBe(requireStudent);
        expect(router.stack.some((l) => l.route && l.route.path === '/ask')).toBe(false);
    });

    it('says who is here, when the room opens, today\'s state and the past reports', async () => {
        const { body } = await call('get', '/');
        expect(body).toMatchObject({ success: true, enabled: true, name: 'Priya', domain: 'Web Development', assistant: 'TEN AI Coordinator', questions: 8, state: 'open', sessionId: null,
            schedule: { open: true, nextLabel: 'Sunday, 13 December 2026' }, reports: [{ id: 's0', overall: 6 }] });
    });

    it('starts the interview at the chosen level, and answers 403 outside the opening', async () => {
        expect((await call('post', '/interview/start', { difficulty: 'Hard' })).body).toMatchObject({ success: true, sessionId: 's1', question: 'Q1', of: 8, difficulty: 'hard' });
        expect(await call('post', '/interview/start', {}, Object.assign({}, student, { domain: 'closed' })))
            .toEqual({ status: 403, body: { success: false, message: 'The interview opens every second Sunday. Next: Sunday, 27 December 2026 (IST).', closed: true } });
    });

    it('passes the answer, its seconds and the camera totals through, with the service\'s own messages on a refusal', async () => {
        const proctor = { checker: 'mediapipe', attentiveMs: 1000 };
        expect((await call('post', '/interview/answer', { sessionId: 's1', answer: 'An API.', seconds: 42, proctor })).body)
            .toMatchObject({ success: true, score: 7, question: 'Q2', got: { seconds: 42, proctor } });
        expect(await call('post', '/interview/answer', { sessionId: 's1', answer: '' })).toEqual({ status: 400, body: { success: false, message: 'Say or type your answer first.', closed: false } });
        expect((await call('post', '/interview/answer', { sessionId: 's1', answer: 'busy' })).status).toBe(503);
        expect((await call('post', '/interview/finish', { sessionId: 's1', proctor })).body).toEqual({ success: true, report: { overall: 7 } });
    });

    it('is switched off with the AI Coordinator', async () => {
        process.env.AI_COORDINATOR = 'off';
        expect((await call('post', '/interview/start')).status).toBe(503);
        expect((await call('post', '/interview/answer', { sessionId: 's1', answer: 'hi' })).status).toBe(503);
        expect((await call('get', '/')).body).toMatchObject({ enabled: false, state: 'off', reports: [], levels: ['easy', 'medium', 'hard'], schedule: { open: false } });
    });
});
