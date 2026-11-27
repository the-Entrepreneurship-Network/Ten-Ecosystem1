'use strict';

/**
 * Gemini for the Career Studio agents: cached, capped, and never required.
 *
 * Every caller already has a rule-based answer. This returns a result only
 * when the AI can give one now, and otherwise says why not, so the caller
 * shows its rules instead:
 *
 *   from 'cache' | 'ai'  — result is Gemini's answer (callers still check it)
 *   from 'off'           — no key, or the daily limit is set to 0
 *   from 'limit'         — this student's or today's calls are used up
 *   from 'slow'          — no answer in time; it is saved when it comes
 *   from 'error'         — Gemini refused, or is out of quota for a while
 *
 * Gemini's free quota is shared with the exam papers and the AI Coordinator,
 * so the limits are small and counted per IST day, the way the coordinator
 * counts its pre-checks.
 */

const crypto = require('crypto');
const gemini = require('../../utils/gemini');
const { istDateKey } = require('../../utils/dateKey');

const intEnv = (name, fallback) => {
    const n = parseInt(process.env[name], 10);
    return Number.isFinite(n) && n >= 0 ? n : fallback;
};
/* Calls a day for one student, and for every student together. 0 switches the AI off. */
const PER_STUDENT = () => intEnv('CAREER_AI_PER_STUDENT', 15);
const PER_DAY = () => intEnv('CAREER_AI_PER_DAY', 150);
/* How long a student waits before seeing the rules. */
const WAIT_MS = () => intEnv('CAREER_AI_WAIT_MS', 20000);
/* After Gemini says it is busy or out of quota, nobody asks it again for this long. */
const PAUSE_MS = 10 * 60 * 1000;

let pausedUntil = 0;
const LIMIT = Symbol('limit');
const inFlight = new Map();

const keyOf = (kind, input) => crypto.createHash('sha256').update(`${kind}\n${JSON.stringify(input)}`).digest('hex');
const istMidnight = () => new Date(`${istDateKey()}T00:00:00+05:30`);
const Call = () => require('../../models/CareerAiCall');
/* Gemini's errors carry a status and a body excerpt, never the key. */
const warn = (kind, err) => console.warn(`[career-ai] ${kind}: ${String((err && err.message) || err).slice(0, 160)}`);

/**
 * Ask once. `input` is everything the answer depends on (it is the cache key);
 * `prompt` and `schema` go to Gemini as they are.
 */
async function ask(kind, subject, input, prompt, schema) {
    if (!gemini.ready() || !PER_DAY() || !PER_STUDENT()) return { result: null, from: 'off' };
    const key = keyOf(kind, input);
    try {
        const hit = await Call().findOne({ key }).lean();
        if (hit) return { result: hit.result, from: 'cache' };
        if (Date.now() < pausedUntil) return { result: null, from: 'error' };

        /* Registered before anything is awaited, so a second click joins this call. */
        let call = inFlight.get(key);
        if (!call) {
            call = (async () => {
                const since = istMidnight();
                const [mine, all] = await Promise.all([
                    Call().countDocuments({ subject: String(subject || ''), createdAt: { $gte: since } }),
                    Call().countDocuments({ createdAt: { $gte: since } }),
                ]);
                if (mine >= PER_STUDENT() || all >= PER_DAY()) return LIMIT;
                return gemini.ask(prompt, schema).then((result) => {
                    /* A cache that cannot be written costs a repeat call, not this answer. */
                    Call().create({ key, kind, subject: String(subject || ''), result })
                        .catch((err) => { if (err.code !== 11000) warn(kind, err); });
                    return result;
                }, (err) => {
                    if ([429, 503].includes(err && err.status) || (err && err.timeout)) pausedUntil = Date.now() + PAUSE_MS;
                    warn(kind, err);
                    return null;
                });
            })().catch((err) => { warn(kind, err); return null; })
                .finally(() => inFlight.delete(key));
            inFlight.set(key, call);
        }

        const SLOW = Symbol('slow');
        const out = await Promise.race([call, new Promise((done) => setTimeout(done, WAIT_MS(), SLOW).unref())]);
        if (out === SLOW) return { result: null, from: 'slow' };
        if (out === LIMIT) return { result: null, from: 'limit' };
        return out ? { result: out, from: 'ai' } : { result: null, from: 'error' };
    } catch (err) {
        warn(kind, err);
        return { result: null, from: 'error' };
    }
}

/* What the student is told when the AI could not answer. */
const NOTES = {
    off: '',
    limit: 'Today\'s AI checks are used up, so this is the agent\'s own reading. More tomorrow.',
    slow: 'The AI is taking a while. This is the agent\'s own reading; try again in a minute and the AI answer will be ready.',
    error: 'The AI is busy right now, so this is the agent\'s own reading.',
};

module.exports = { ask, NOTES, keyOf, _reset: () => { pausedUntil = 0; inFlight.clear(); } };
