'use strict';

/**
 * The AI Meeting Room (/meeting): a student talks to the AI Coordinator by
 * voice or text, in two modes.
 *
 *   Ask a question   the same brain as the chat (aiCoordinator.decide): a
 *                    hand-over to the human coordinator for marks, complaints,
 *                    money and personal matters, a saved help-desk answer when
 *                    one fits, Gemini otherwise, with the student's own progress.
 *   Mock interview   Gemini asks five questions for the student's domain and
 *                    week, scores each spoken or typed answer out of 10 with
 *                    two sentences of feedback, and writes a short report that
 *                    is saved (models/MeetingSession.js).
 *
 * Listening and speaking happen in the student's browser (Chrome's speech
 * recognition, the device's voices), so this costs nothing: the server only
 * passes text. It is an AI and says so; it approves and marks nothing.
 */

const mongoose = require('mongoose');
const MeetingSession = require('../models/MeetingSession');
const AiCoordinatorLog = require('../models/AiCoordinatorLog');
const gemini = require('../utils/gemini');
const { istDayStart, istDateKey } = require('../utils/dateKey');
const ai = require('./aiCoordinator');

/** Questions in one mock interview. */
const QUESTIONS = 5;
/** Gemini turns per student per day in the room, on top of the chat's own limit. */
const TURNS_PER_DAY = 40;
const BUSY = 'The AI is busy right now. Try again in a minute, or message your coordinator in Messages.';

const clean = (s, max) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, max);

async function turnsToday(employeeId) {
    return AiCoordinatorLog.countDocuments({
        employeeId, kind: 'meeting', source: { $in: ['ask-ai', 'interview'] }, createdAt: { $gte: istDayStart(istDateKey()) }
    });
}

function log(student, source, question, reply, reason) {
    return AiCoordinatorLog.create({
        kind: 'meeting', employeeId: student.employeeId || '', studentId: student._id || null, domain: student.domain || '',
        question: clean(question, 1000), reply: clean(reply, 2000), source, reason: reason || ''
    }).catch((err) => console.error('[ai-meeting] log failed:', err.message));
}

// ── Ask a question ───────────────────────────────────────────────────────

/** One question, answered as the chat would. { reply, source, handover } */
async function ask({ student, text }) {
    const question = clean(text, 2000);
    const out = await ai.decide({ text: question, student, domain: student.domain, employeeId: student.employeeId });
    if (out.handover) {
        await ai.notifyCoordinators({ student, employeeId: student.employeeId, domain: student.domain, reason: out.source });
    }
    await log(student, out.handover ? 'handover' : (out.source === 'ai' ? 'ask-ai' : 'ask'), question, out.reply, out.source);
    return { reply: out.reply, source: out.source, handover: !!out.handover };
}

// ── Mock interview ───────────────────────────────────────────────────────

const SCHEMA = {
    type: gemini.Type.OBJECT,
    properties: {
        score: { type: gemini.Type.INTEGER },
        feedback: { type: gemini.Type.STRING },
        question: { type: gemini.Type.STRING },
        done: { type: gemini.Type.BOOLEAN },
        summary: { type: gemini.Type.STRING },
        overall: { type: gemini.Type.INTEGER }
    },
    required: ['question', 'done']
};

/**
 * The whole interview so far, and what to do next: score the answer just
 * given (if any), then the next question, or the report when QUESTIONS are
 * done. The student's name, email, phone and Employee ID are never sent.
 */
function interviewPrompt({ domain, context, turns, answer, number }) {
    const last = turns.length ? turns[turns.length - 1] : null;
    const history = turns.slice(0, -1).map((t, i) => `Q${i + 1}: ${t.question}\nA${i + 1}: ${t.answer || '(no answer)'} (score ${t.score == null ? '-' : t.score}/10)`).join('\n');
    const finishing = number > QUESTIONS;
    return [
        `You are TEN's AI mock interviewer for an intern in the ${domain || 'software'} internship. You are an AI assistant, not a person. ` +
        'You speak plain Indian English in short sentences, kind and direct, as a friendly interviewer would in a real company interview.',
        'About the intern (no personal details):',
        context,
        history ? `Interview so far:\n${history}` : (answer ? '' : 'The interview is starting.'),
        last && answer ? `Q${turns.length}: ${last.question}\nThe intern's answer, spoken aloud and transcribed, so ignore small transcription slips:\n"${last.answer}"` : '',
        last && answer ? 'Score this answer from 0 to 10 for correctness and clarity, and give feedback in at most two sentences: ' +
            'one thing that was good, one thing to add or fix. Be fair; a short correct answer is not a weak one.' : '',
        finishing
            ? `That was question ${QUESTIONS} of ${QUESTIONS}. Set done to true, leave question empty, and write the report: a summary of at most ` +
              'four sentences (strengths, the gap to work on, one concrete next step), and an overall score from 0 to 10.'
            : `Now ask question ${number} of ${QUESTIONS}. One question only, under 40 words, no multi-part questions, on a topic not asked yet: ` +
              'a mix of a concept, a practical "how would you", and one about the intern\'s own current task. Set done to false.',
        'Answer with JSON: "score", "feedback", "question", "done", "summary", "overall".'
    ].filter(Boolean).join('\n\n');
}

const view = (s) => ({
    id: String(s._id), domain: s.domain, startedAt: s.startedAt, endedAt: s.endedAt, overall: s.overall, summary: s.summary,
    questions: s.turns.length, turns: s.turns.map((t) => ({ question: t.question, answer: t.answer, score: t.score, feedback: t.feedback }))
});

async function askGemini(student, prompt) {
    if (!gemini.ready()) return { error: 'The AI is not set up on this server yet. Ask your coordinator in Messages.' };
    if (await turnsToday(student.employeeId) >= TURNS_PER_DAY) {
        return { error: "You've practised a lot today: the AI picks up again tomorrow. Your coordinator is in Messages if it can't wait." };
    }
    try {
        return { out: await gemini.ask(prompt, SCHEMA) };
    } catch (err) {
        console.warn('[ai-meeting] Gemini did not answer:', err.message);
        return { error: BUSY };
    }
}

/** A new interview: the session and its first question. */
async function startInterview({ student }) {
    const context = await ai.contextFor(student, student.domain, {});
    const r = await askGemini(student, interviewPrompt({ domain: student.domain, context, turns: [], number: 1 }));
    if (r.error) return { error: r.error };
    const question = clean(r.out.question, 400);
    if (!question) return { error: BUSY };
    const session = await MeetingSession.create({
        studentId: student._id, employeeId: student.employeeId, domain: student.domain || '', turns: [{ question }]
    });
    await log(student, 'interview', 'start', question);
    return { sessionId: String(session._id), question, number: 1, of: QUESTIONS };
}

async function openSession(student, sessionId) {
    if (!mongoose.Types.ObjectId.isValid(String(sessionId))) return null;
    return MeetingSession.findOne({ _id: sessionId, studentId: student._id, endedAt: null });
}

/** The student's answer: its score and feedback, then the next question or the report. */
async function answerInterview({ student, sessionId, answer }) {
    const session = await openSession(student, sessionId);
    if (!session) return { error: 'This interview is over. Start a new one.' };
    const said = clean(answer, 3000);
    if (!said) return { error: 'Say or type your answer first.' };
    const last = session.turns[session.turns.length - 1];
    if (last.answer) return { error: 'That question is already answered. Wait for the next one.' };
    const context = await ai.contextFor(student, student.domain, {});
    // Stored scrubbed: a phone number or address said aloud never reaches Gemini,
    // neither now nor in the transcript of the next question.
    last.answer = ai.scrub(said);
    const number = session.turns.length + 1;
    const r = await askGemini(student, interviewPrompt({ domain: session.domain, context, turns: session.turns, answer: said, number }));
    if (r.error) { last.answer = ''; return { error: r.error }; }
    const out = r.out || {};
    last.score = Number.isFinite(Number(out.score)) ? Math.max(0, Math.min(10, Math.round(Number(out.score)))) : null;
    last.feedback = clean(out.feedback, 600);
    let next = null;
    if (number > QUESTIONS || out.done || !clean(out.question, 400)) {
        session.endedAt = new Date();
        session.summary = clean(out.summary, 1200);
        session.overall = Number.isFinite(Number(out.overall)) ? Math.max(0, Math.min(10, Math.round(Number(out.overall)))) : average(session.turns);
    } else {
        next = clean(out.question, 400);
        session.turns.push({ question: next });
    }
    await session.save();
    await log(student, 'interview', last.question, `score ${last.score}: ${last.feedback}`);
    return {
        score: last.score, feedback: last.feedback, question: next, number: next ? number : QUESTIONS, of: QUESTIONS,
        done: !next, report: next ? null : view(session)
    };
}

const average = (turns) => {
    const scores = turns.map((t) => t.score).filter((s) => typeof s === 'number');
    return scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null;
};

/** The student stops early: the report from what was answered. No AI call. */
async function finishInterview({ student, sessionId }) {
    const session = await openSession(student, sessionId);
    if (!session) return { error: 'This interview is over.' };
    if (!session.turns[session.turns.length - 1].answer) session.turns.pop();
    session.endedAt = new Date();
    session.overall = average(session.turns);
    const n = session.turns.length;
    session.summary = n
        ? `You answered ${n} of ${QUESTIONS} questions, averaging ${session.overall}/10. Come back for the full five when you have fifteen minutes.`
        : 'No answers yet. Start again when you are ready: the questions are new each time.';
    await session.save();
    return { report: view(session) };
}

/** The student's recent reports, newest first. */
async function reports({ student }) {
    const rows = await MeetingSession.find({ studentId: student._id, endedAt: { $ne: null } }).sort({ startedAt: -1 }).limit(10).lean();
    return rows.map(view);
}

module.exports = { ask, startInterview, answerInterview, finishInterview, reports, QUESTIONS, TURNS_PER_DAY, _internal: { interviewPrompt, average, BUSY } };
