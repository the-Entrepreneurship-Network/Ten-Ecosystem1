'use strict';

/**
 * The Career Studio's Gemini calls: cached, limited per student and per day,
 * and never in the way. Gemini's free quota is shared with the exams and the
 * AI Coordinator, so a limit reached or a quota error must fall back to the
 * agents' own rules, quickly.
 */

const rows = [];
jest.mock('../../models/CareerAiCall', () => ({
    findOne: jest.fn((q) => ({ lean: async () => rows.find((r) => r.key === q.key) || null })),
    countDocuments: jest.fn(async (q) => rows.filter((r) => (q.subject === undefined || r.subject === q.subject)
        && r.createdAt >= q.createdAt.$gte).length),
    create: jest.fn(async (doc) => { rows.push({ ...doc, createdAt: new Date() }); return doc; }),
}));
jest.mock('../../utils/gemini', () => ({ ready: jest.fn(() => true), ask: jest.fn() }));

const gemini = require('../../utils/gemini');
const careerAi = require('../../services/v2/careerAi');
const flush = () => new Promise((r) => setImmediate(r));

beforeEach(() => {
    rows.length = 0;
    careerAi._reset();
    gemini.ask.mockReset();
    gemini.ready.mockReturnValue(true);
    delete process.env.CAREER_AI_PER_STUDENT;
    delete process.env.CAREER_AI_PER_DAY;
    delete process.env.CAREER_AI_WAIT_MS;
    jest.spyOn(console, 'warn').mockImplementation(() => {});
});

it('asks once, then answers the same question from the cache', async () => {
    gemini.ask.mockResolvedValue({ score: 80 });
    expect(await careerAi.ask('match.v1', 's1', { a: 1 }, 'p', {})).toEqual({ result: { score: 80 }, from: 'ai' });
    await flush();
    expect(await careerAi.ask('match.v1', 's2', { a: 1 }, 'p', {})).toEqual({ result: { score: 80 }, from: 'cache' });
    expect(gemini.ask).toHaveBeenCalledTimes(1);
});

it('stops at the student\'s daily limit, and at everyone\'s', async () => {
    process.env.CAREER_AI_PER_STUDENT = '2';
    gemini.ask.mockResolvedValue({ ok: true });
    for (const n of [1, 2]) { await careerAi.ask('k', 's1', { n }, 'p', {}); await flush(); }
    expect((await careerAi.ask('k', 's1', { n: 3 }, 'p', {})).from).toBe('limit');
    expect((await careerAi.ask('k', 's2', { n: 3 }, 'p', {})).from).toBe('ai');   // another student is not held back
    process.env.CAREER_AI_PER_DAY = '3';
    await flush();
    expect((await careerAi.ask('k', 's3', { n: 4 }, 'p', {})).from).toBe('limit');
    expect(gemini.ask).toHaveBeenCalledTimes(3);
});

it('is off without a key, or with a limit of 0', async () => {
    gemini.ready.mockReturnValue(false);
    expect((await careerAi.ask('k', 's', {}, 'p', {})).from).toBe('off');
    gemini.ready.mockReturnValue(true);
    process.env.CAREER_AI_PER_DAY = '0';
    expect((await careerAi.ask('k', 's', {}, 'p', {})).from).toBe('off');
    expect(gemini.ask).not.toHaveBeenCalled();
});

it('after a quota error, nobody waits on Gemini for a while', async () => {
    gemini.ask.mockRejectedValue(Object.assign(new Error('Gemini returned 429: quota'), { status: 429 }));
    expect((await careerAi.ask('k', 's', { n: 1 }, 'p', {})).from).toBe('error');
    expect((await careerAi.ask('k', 's', { n: 2 }, 'p', {})).from).toBe('error');
    expect(gemini.ask).toHaveBeenCalledTimes(1);
});

it('a slow answer is not waited for, and is ready for the next click', async () => {
    process.env.CAREER_AI_WAIT_MS = '20';
    let answer;
    gemini.ask.mockReturnValue(new Promise((r) => { answer = r; }));
    expect((await careerAi.ask('k', 's', { n: 1 }, 'p', {})).from).toBe('slow');
    answer({ late: true });
    await flush(); await flush();
    expect(await careerAi.ask('k', 's', { n: 1 }, 'p', {})).toEqual({ result: { late: true }, from: 'cache' });
    expect(gemini.ask).toHaveBeenCalledTimes(1);
});

it('two clicks at once are one call', async () => {
    let answer;
    gemini.ask.mockReturnValue(new Promise((r) => { answer = r; }));
    const a = careerAi.ask('k', 's', { n: 1 }, 'p', {});
    const b = careerAi.ask('k', 's', { n: 1 }, 'p', {});
    await flush();
    answer({ one: 1 });
    expect((await a).result).toEqual({ one: 1 });
    expect((await b).result).toEqual({ one: 1 });
    expect(gemini.ask).toHaveBeenCalledTimes(1);
});
