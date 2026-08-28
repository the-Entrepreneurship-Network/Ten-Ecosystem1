'use strict';

/**
 * Question generation and grading for the LLM portal.
 *
 * Both jobs go to Gemini — the same model, key and client this codebase
 * already uses in production for task generation (routes/v2/studentPortal.js).
 * Questions are generated fresh from the topic's own module text at the start
 * of every attempt, which is what makes a retake's paper different from the
 * first sitting's without anybody maintaining a question bank. Written answers
 * are graded by the model against the question and the module text, with a
 * one-line reason the learner sees.
 *
 * Without a GEMINI_API_KEY the exam does not degrade into something that only
 * looks like an exam — it refuses to start, politely. The user asked for AI
 * review by name; a keyword matcher wearing its clothes is worse than an
 * honest "try again shortly".
 *
 * ponytail: grading trusts one model pass per paper. If disputed marks become
 * a support burden, add a second pass on the failures only.
 */

const TOPIC_WRITTEN = 10;   // section 1, as specified
const TOPIC_MCQ     = 10;   // section 2
const FINAL_WRITTEN = 20;   // the final is the same shape, only bigger
const FINAL_MCQ     = 30;

const TOPIC_MINUTES = 40;
const FINAL_MINUTES = 120;  // two hours, as specified

const PASS_WRITTEN = 0.6;   // 6 of 10 written answers accepted
const PASS_MCQ     = 0.6;

/**
 * The key, under whichever name this deployment set it.
 *
 * The exam was answering "the examiner is offline" on a server that had a
 * working Gemini key — under a different one of these three names. Reading one
 * name and calling the feature broken is a support ticket, not a check.
 */
function apiKey() {
    return process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || process.env.GEMINI_KEY || '';
}

function ready() {
    return !!apiKey();
}

/**
 * Why the examiner is unavailable, in words a person can act on. Returned to
 * HR and the admin, never to the learner — it names environment variables.
 */
function diagnose() {
    if (!apiKey()) {
        return { ok: false, reason: 'no-key',
                 detail: 'No Gemini key on this server. Set GEMINI_API_KEY (or GOOGLE_API_KEY) and restart.' };
    }
    return { ok: true, reason: 'ready', detail: 'A key is present. Run the live check to confirm the model answers.' };
}

/** One real round trip, so "it should work" can be replaced with "it does". */
async function selfTest() {
    if (!ready()) return diagnose();
    const { Type } = require('@google/genai');
    try {
        const out = await gemini('Reply with {"ok":true}. Nothing else.',
            { type: Type.OBJECT, properties: { ok: { type: Type.BOOLEAN } }, required: ['ok'] });
        return { ok: !!(out && out.ok), reason: 'live', detail: 'The model answered.' };
    } catch (err) {
        return { ok: false, reason: 'call-failed', detail: String((err && err.message) || err).slice(0, 300) };
    }
}

async function gemini(prompt, schema) {
    const { GoogleGenAI } = require('@google/genai');
    const ai = new GoogleGenAI({
        apiKey: apiKey(),
        httpOptions: { headers: { 'User-Agent': 'aistudio-build' } }
    });
    const res = await ai.models.generateContent({
        model: 'gemini-2.0-flash',
        contents: prompt,
        config: { responseMimeType: 'application/json', responseSchema: schema }
    });
    return JSON.parse(res.text);
}

/**
 * A fresh paper for one topic (or the final, topicN = 0).
 *
 * @param {object} mod    the module from config/learnCurriculum
 * @param {number} topicN 1-based topic, or 0 for the final over every topic
 * @returns {Promise<Array<{kind, prompt, options?, answerIndex?}>>}
 */
async function generatePaper(mod, topicN) {
    const { Type } = require('@google/genai');
    const isFinal = topicN === 0;
    const wanted = { written: isFinal ? FINAL_WRITTEN : TOPIC_WRITTEN,
                     mcq:     isFinal ? FINAL_MCQ     : TOPIC_MCQ };

    const source = isFinal
        ? mod.topics.map((t) => `### ${t.title} (difficulty ${t.difficulty}/5)\n${t.technical}`).join('\n\n')
        : (() => { const t = mod.topics[topicN - 1];
                   return `### ${t.title} (difficulty ${t.difficulty}/5)\n${t.technical}\n\nIn simple terms: ${t.simple}`; })();

    const prompt = `You are setting an exam for the "${mod.name}" course.
Set questions ONLY on the material below. Difficulty should match the stated level${isFinal ? 's, mixing easy early topics with hard late ones' : ''}.
Generate exactly ${wanted.written} open written questions (each answerable in 2-6 sentences, testing understanding, not recall of exact wording) and exactly ${wanted.mcq} multiple-choice questions (4 options each, exactly one correct, plausible distractors).
Number nothing; no answer text inside prompts.

MATERIAL:
${source.slice(0, 24000)}`;

    const schema = {
        type: Type.OBJECT,
        properties: {
            written: { type: Type.ARRAY, items: { type: Type.STRING } },
            mcq: {
                type: Type.ARRAY,
                items: {
                    type: Type.OBJECT,
                    properties: {
                        prompt: { type: Type.STRING },
                        options: { type: Type.ARRAY, items: { type: Type.STRING } },
                        answerIndex: { type: Type.INTEGER }
                    },
                    required: ['prompt', 'options', 'answerIndex']
                }
            }
        },
        required: ['written', 'mcq']
    };

    const out = await gemini(prompt, schema);
    const written = (out.written || []).slice(0, wanted.written)
        .map((q) => ({ kind: 'written', prompt: String(q) }));
    const mcq = (out.mcq || []).slice(0, wanted.mcq)
        .filter((m) => Array.isArray(m.options) && m.options.length === 4
            && m.answerIndex >= 0 && m.answerIndex < 4)
        .map((m) => ({ kind: 'mcq', prompt: String(m.prompt),
                       options: m.options.map(String), answerIndex: m.answerIndex }));

    // A paper missing most of itself is a failed generation, not a short exam.
    if (written.length < wanted.written * 0.8 || mcq.length < wanted.mcq * 0.8) {
        throw new Error(`generation came back short (${written.length} written, ${mcq.length} mcq)`);
    }
    return [...written, ...mcq];
}

/**
 * Grade the written section. MCQs are graded by index comparison in the route;
 * only prose needs a reader.
 *
 * @param {object} mod
 * @param {number} topicN
 * @param {Array<{prompt, answer}>} pairs
 * @returns {Promise<Array<{correct: boolean, feedback: string}>>}
 */
async function gradeWritten(mod, topicN, pairs) {
    const { Type } = require('@google/genai');
    const topic = topicN > 0 ? mod.topics[topicN - 1] : null;
    const context = topic
        ? `${topic.title}\n${topic.technical}`
        : mod.topics.map((t) => `${t.title}: ${t.technical}`).join('\n').slice(0, 20000);

    const prompt = `You are marking a student's written exam for "${mod.name}".
For each question/answer pair, decide if the answer genuinely addresses THIS question and is substantially correct against the course material. An answer that is off-topic, empty, copied from the question, or wrong is incorrect. Be fair to imperfect wording from a learner; be unforgiving to irrelevance.
Give one short sentence of feedback each.

COURSE MATERIAL:
${context}

ANSWERS:
${pairs.map((p, i) => `Q${i + 1}: ${p.prompt}\nA${i + 1}: ${String(p.answer || '(blank)').slice(0, 1500)}`).join('\n\n')}`;

    const schema = {
        type: Type.OBJECT,
        properties: {
            results: {
                type: Type.ARRAY,
                items: {
                    type: Type.OBJECT,
                    properties: {
                        correct: { type: Type.BOOLEAN },
                        feedback: { type: Type.STRING }
                    },
                    required: ['correct', 'feedback']
                }
            }
        },
        required: ['results']
    };

    const out = await gemini(prompt, schema);
    const results = (out.results || []).slice(0, pairs.length)
        .map((r) => ({ correct: !!r.correct, feedback: String(r.feedback || '').slice(0, 300) }));
    // Grade every answer or grade none — a half-marked paper is a dispute factory.
    if (results.length !== pairs.length) throw new Error('grader returned the wrong number of results');
    return results;
}

module.exports = {
    ready, diagnose, selfTest, generatePaper, gradeWritten,
    TOPIC_WRITTEN, TOPIC_MCQ, FINAL_WRITTEN, FINAL_MCQ,
    TOPIC_MINUTES, FINAL_MINUTES, PASS_WRITTEN, PASS_MCQ
};
