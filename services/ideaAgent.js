'use strict';

/**
 * The idea agent — a scheduled job that proposes things TEN could build.
 *
 * It wakes on a cron, asks the model for a few concrete proposals grounded in
 * what TEN already runs, and writes them to the AgentIdea collection as
 * `pending_review`. That is the whole job.
 *
 * What it deliberately does NOT do:
 *
 *   - build anything
 *   - deploy anything
 *   - send anything to anybody
 *
 * The brief was an agent that finds ideas, builds sites and deploys them. The
 * finding is safe to automate; the building and deploying are not, because an
 * unattended model publishing under TEN's name cannot be taken back and the
 * bill has no ceiling. So this ships the half that is safe, behind a review
 * step a person owns — the same shape the internship fee already uses. The
 * build step can be added on top of an approved row once there is something
 * worth building and somebody has read it.
 *
 * Cost: one model call per run. At the default schedule (twice a day) and
 * Flash pricing this is pennies a month, and MAX_IDEAS_PER_DAY is a hard stop
 * regardless of how often the cron fires.
 *
 * It is OFF unless IDEA_AGENT_ENABLED=true. Nothing starts spending money
 * because a deploy happened.
 */

const cron = require('node-cron');
const { ask, ready, Type, GEMINI_MODEL } = require('../utils/gemini');
const AgentIdea = require('../models/AgentIdea');

/** How many proposals one run asks for. */
const IDEAS_PER_RUN = 3;

/**
 * The ceiling, counted over the last 24 hours of rows.
 *
 * A cron typo that fires every minute instead of twice a day is one character
 * away, and would otherwise mean 1,440 model calls a day. This is the backstop that
 * makes the schedule a preference rather than the only thing between us and
 * a bill.
 */
const MAX_IDEAS_PER_DAY = 12;

const SCHEMA = {
    type: Type.OBJECT,
    properties: {
        ideas: {
            type: Type.ARRAY,
            items: {
                type: Type.OBJECT,
                properties: {
                    title:   { type: Type.STRING },
                    summary: { type: Type.STRING },
                    forWhom: { type: Type.STRING },
                    whyNow:  { type: Type.STRING },
                    effort:  { type: Type.STRING }
                },
                required: ['title', 'summary']
            }
        }
    },
    required: ['ideas']
};

/**
 * What the model is told about TEN.
 *
 * Kept here rather than in the database so a prompt change is a reviewed diff.
 * It describes what already exists so the proposals are adjacent to the real
 * business instead of generic startup advice.
 */
function buildPrompt(n) {
    return [
        'You are proposing concrete, buildable ideas for The Entrepreneurship Network (TEN),',
        'an Indian organisation that runs:',
        '  - a paid online internship portal for college students, with tasks, quizzes,',
        '    attendance, certificates and a career studio (resume, job hunting)',
        '  - a free business simulation game used by school students in class',
        '',
        `Propose exactly ${n} ideas. Each must be something TEN could build with a small`,
        'team in weeks, not a company-sized bet. Favour things that reuse what already',
        'exists over things that need a new product line.',
        '',
        'For each idea give:',
        '  title   - under 10 words',
        '  summary - two or three sentences on what it actually is',
        '  forWhom - which existing audience it serves (students, schools, colleges, staff)',
        '  whyNow  - one sentence on why it is worth doing now',
        '  effort  - exactly one of: small, medium, large',
        '',
        'Do not propose payment gateways. Do not propose anything that needs a new',
        'paid subscription or raises monthly running costs.'
    ].join('\n');
}

/** Rows written in the last 24 hours — the spend so far. */
async function ideasInLastDay() {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    return AgentIdea.countDocuments({ createdAt: { $gte: since } });
}

/**
 * One run: ask once, store what comes back.
 *
 * Returns a small report rather than throwing, so a scheduled run can log a
 * failure without taking the process down. The cron has no caller to catch it.
 *
 * @returns {Promise<{ok: boolean, reason: string, stored: number, runId: string|null}>}
 */
async function runOnce() {
    if (!ready()) {
        return { ok: false, reason: 'no-key', stored: 0, runId: null };
    }

    const already = await ideasInLastDay();
    if (already >= MAX_IDEAS_PER_DAY) {
        return { ok: false, reason: 'daily-cap', stored: 0, runId: null };
    }

    // Never write more than the cap allows, even if the model is generous.
    const room = Math.min(IDEAS_PER_RUN, MAX_IDEAS_PER_DAY - already);

    let out;
    try {
        out = await ask(buildPrompt(room), SCHEMA);
    } catch (err) {
        return {
            ok: false,
            reason: 'model-failed',
            detail: String((err && err.message) || err).slice(0, 300),
            stored: 0,
            runId: null
        };
    }

    const ideas = Array.isArray(out && out.ideas) ? out.ideas.slice(0, room) : [];
    if (!ideas.length) {
        return { ok: false, reason: 'empty', stored: 0, runId: null };
    }

    const runId = 'IDEA-' + Date.now().toString(36).toUpperCase();
    const model = GEMINI_MODEL();

    const rows = ideas
        .filter((i) => i && i.title && i.summary)
        .map((i) => ({
            runId,
            title:   String(i.title).slice(0, 200),
            summary: String(i.summary).slice(0, 2000),
            forWhom: String(i.forWhom || '').slice(0, 200),
            whyNow:  String(i.whyNow || '').slice(0, 500),
            effort:  ['small', 'medium', 'large'].includes(String(i.effort || '').toLowerCase())
                ? String(i.effort).toLowerCase()
                : 'medium',
            model,
            status: 'pending_review'
        }));

    if (!rows.length) return { ok: false, reason: 'empty', stored: 0, runId: null };

    await AgentIdea.insertMany(rows);
    return { ok: true, reason: 'stored', stored: rows.length, runId };
}

let started = false;

/**
 * Schedule the agent.
 *
 * Guarded the same way services/automationCron.js is: under PM2 cluster mode
 * every worker runs server.js, so without the worker check N workers would
 * each fire the same job against the same database — N model calls and N sets
 * of duplicate rows for one scheduled slot.
 */
function initIdeaAgent() {
    if (started) return { started: false, reason: 'already-started' };

    if (String(process.env.IDEA_AGENT_ENABLED || '').toLowerCase() !== 'true') {
        console.log('[IDEA-AGENT] Off. Set IDEA_AGENT_ENABLED=true to run it.');
        return { started: false, reason: 'disabled' };
    }

    const worker = process.env.NODE_APP_INSTANCE;
    if (!(worker === undefined || worker === '0')) {
        console.log(`[IDEA-AGENT] Skipped on cluster worker ${worker}; worker 0 runs it.`);
        return { started: false, reason: 'not-cron-worker' };
    }

    if (!ready()) {
        console.log('[IDEA-AGENT] No Gemini key on this server — not scheduling.');
        return { started: false, reason: 'no-key' };
    }

    // Twice a day, well away from the top of the hour that every other job uses.
    const expr = process.env.IDEA_AGENT_CRON || '17 7,19 * * *';
    if (!cron.validate(expr)) {
        console.error(`[IDEA-AGENT] IDEA_AGENT_CRON is not a valid expression: ${expr}`);
        return { started: false, reason: 'bad-cron' };
    }

    cron.schedule(expr, async () => {
        try {
            const r = await runOnce();
            console.log(`[IDEA-AGENT] run: ${r.reason}, stored ${r.stored}`);
        } catch (err) {
            // A scheduled job has no caller; an unhandled rejection here would
            // take the process down with it.
            console.error('[IDEA-AGENT] run failed:', (err && err.message) || err);
        }
    }, { timezone: 'Asia/Kolkata' });

    started = true;
    console.log(`[IDEA-AGENT] Scheduled: ${expr} (Asia/Kolkata), max ${MAX_IDEAS_PER_DAY}/day.`);
    return { started: true, reason: 'scheduled', expr };
}

module.exports = {
    initIdeaAgent,
    runOnce,
    buildPrompt,
    ideasInLastDay,
    IDEAS_PER_RUN,
    MAX_IDEAS_PER_DAY,
    SCHEMA
};
