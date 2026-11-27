'use strict';

/**
 * The Interview Room (/meeting): the AI Coordinator interviews the student on
 * camera, every second Sunday.
 *
 *   Schedule   open on alternate Sundays (IST) counted from ANCHOR, one
 *              interview per student per opening. INTERVIEW_OPEN=always opens
 *              it every day, for a trial.
 *   Questions  QUESTIONS of them, written by Gemini from the topics of the
 *              tasks the student has been given so far (coordinator tasks, the
 *              Task Journey, submitted work), at the level of a company
 *              interview: the ideas, trade-offs and debugging behind the
 *              tasks, never the task text itself. Each spoken or typed answer
 *              is scored out of 10 with two sentences of feedback.
 *   Camera     required. The page checks, in the browser, that one face is in
 *              frame with its eyes on the camera, and sends the running totals
 *              with each answer; they are kept with the session and go into
 *              the report. ponytail: client-reported; checking the video on
 *              the server would cost money and the room must stay at ₹0.
 *   Report     a mark per question, an overall mark, the strengths, the gaps
 *              and what to work on before the next interview. Saved
 *              (models/MeetingSession.js), shown on the page, emailed to the
 *              student, and counted in the daily report.
 *
 * Who      every student gets one interview (the first try is free; a fee
 *          may come later). They choose easy, medium or hard first; the domain
 *          is theirs already. With INTERVIEW_OPEN=always (a trial) the room is
 *          open every day, interviews can be repeated, and they do not use up
 *          the one attempt.
 *   The AI   Gemini (free) or Claude (paid per interview), chosen in the admin
 *            portal (models/InterviewSetting.js). Claude needs
 *            ANTHROPIC_API_KEY and stops at the monthly cap set there; an
 *            interview keeps the AI it started with, and a turn Claude fails
 *            is answered by Gemini.
 *
 * Listening and speaking happen in the browser (Web Speech API), so the
 * server only passes text. It is an AI and says so; a person can still
 * overrule a mark.
 */

const mongoose = require('mongoose');
const MeetingSession = require('../models/MeetingSession');
const InterviewSetting = require('../models/InterviewSetting');
const AiCoordinatorLog = require('../models/AiCoordinatorLog');
const TaskAssignment = require('../models/TaskAssignment');
const StudentTaskProgress = require('../models/new/StudentTaskProgress');
const DomainTask = require('../models/new/DomainTask');
const gemini = require('../utils/gemini');
const claude = require('../utils/claude');
const { istDayStart, istDateKey, IST_OFFSET_MS } = require('../utils/dateKey');
const ai = require('./aiCoordinator');

/** Questions in one interview. */
const QUESTIONS = 8;
/** AI turns per student per day in the room; one interview is QUESTIONS + 1. */
const TURNS_PER_DAY = 20;
const LEVELS = ['easy', 'medium', 'hard'];
/**
 * What one Claude interview costs, for the admin portal: about 30,000 tokens
 * in and 4,500 out over nine turns, at Anthropic's prices per million tokens
 * (input / output: Haiku 5.5 $0.10 / $0.50, Sonnet 5.5 $2 / $10, Opus 5.5
 * $4 / $20) and ₹85 to the dollar. ponytail: an estimate from the prompt
 * sizes; Anthropic's console shows the real spend.
 */
const CLAUDE_COST_INR = { 'claude-haiku-5-5': 0.5, 'claude-sonnet-5-5': 9, 'claude-opus-5-5': 18 };
/** The first interview Sunday (IST). Every EVERY_DAYS days after it is another. */
const ANCHOR = '2026-11-29';
const EVERY_DAYS = 14;
const DAY_MS = 86400000;
const BUSY = 'The AI is busy right now. Try again in a minute; your interview continues where it stopped.';

const clean = (s, max) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, max);
const nameOf = (s) => s.name || [s.firstName, s.lastName].filter(Boolean).join(' ').trim() || 'there';
// "Sunday, 13 December 2026" for an IST day key. Built by hand: toLocaleDateString's
// en-IN output differs between Node versions' ICU data (Node 18 in CI writes
// "Sunday 13 December, 2026"), and this text goes into emails and the page.
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const longDate = (key) => { const d = new Date(`${key}T12:00:00Z`); return `${DAYS[d.getUTCDay()]}, ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`; };

// ── When ─────────────────────────────────────────────────────────────────

/** Is the room open today (IST), and when are the next two openings. */
function schedule(now = new Date()) {
    const today = istDateKey(now);
    const days = Math.round((istDayStart(today) - istDayStart(ANCHOR)) / DAY_MS);
    const until = days < 0 ? -days : (EVERY_DAYS - (days % EVERY_DAYS)) % EVERY_DAYS;
    const key = (n) => istDateKey(new Date(istDayStart(today).getTime() + n * DAY_MS + 12 * 3600000));
    const trial = /^always$/i.test(process.env.INTERVIEW_OPEN || '');
    const open = trial || until === 0;
    return { open, trial, today, next: open ? today : key(until), following: key(until === 0 ? EVERY_DAYS : open ? until : until + EVERY_DAYS), nextLabel: '', followingLabel: '' };
}
const labelled = (w) => Object.assign(w, { nextLabel: longDate(w.next), followingLabel: longDate(w.following) });

/** The student's interview that is still open, if any. One left open from an earlier day is closed first, with its report. */
async function openSessionOf(student) {
    const open = await MeetingSession.findOne({ studentId: student._id, endedAt: null }).sort({ startedAt: -1 });
    if (open && istDateKey(open.startedAt) !== istDateKey()) {
        await finishSession(student, open, null);
        return null;
    }
    return open;
}

/** Has the student used their one interview? Trial interviews do not count. */
const used = (student) => MeetingSession.exists({ studentId: student._id, trial: { $ne: true }, endedAt: { $ne: null } });

/** For the page: the schedule, the state (open, closed, taken, resume), the levels and past reports. */
async function status({ student }) {
    const when = labelled(schedule());
    const open = await openSessionOf(student);
    const taken = !open && !when.trial && await used(student);
    return {
        schedule: when,
        state: open ? 'resume' : taken ? 'taken' : !when.open ? 'closed' : 'open',
        sessionId: open ? String(open._id) : null,
        difficulty: open ? open.difficulty : null,
        levels: LEVELS,
        reports: await reports({ student })
    };
}

// ── What to ask about ────────────────────────────────────────────────────

/** The titles (and a line of each description) of every task the student has had so far, oldest first. */
async function topicsFor(student) {
    const seen = new Set(); const out = [];
    const add = (title, detail) => {
        const t = clean(title, 120);
        if (!t || seen.has(t.toLowerCase())) return;
        seen.add(t.toLowerCase());
        out.push(detail ? `${t}: ${clean(detail, 220)}` : t);
    };
    const attempt = async (fn) => { try { await fn(); } catch (err) { console.warn('[ai-meeting] topics:', err.message); } };
    await attempt(async () => {
        for (const a of await TaskAssignment.find({ employeeId: student.employeeId }).sort({ unlockedAt: 1 }).select('title description').lean()) add(a.title, a.description);
    });
    await attempt(async () => {
        const rows = await StudentTaskProgress.find({ studentId: student._id, status: { $ne: 'locked' } }).select('taskId').lean();
        if (!rows.length) return;
        for (const t of await DomainTask.find({ _id: { $in: rows.map((r) => r.taskId) } }).sort({ weekNumber: 1 }).select('taskTitle taskDescription').lean()) add(t.taskTitle, t.taskDescription);
    });
    await attempt(async () => {
        for (const s of await mongoose.model('Submission').find({ employeeId: student.employeeId }).sort({ submittedAt: 1 }).select('task').lean()) add(s.task);
    });
    return out.slice(-30);
}

// ── The interview ────────────────────────────────────────────────────────

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
/** The same for Claude, whose structured output wants every field and nothing else. */
const CLAUDE_SCHEMA = {
    type: 'object',
    properties: {
        score: { type: 'integer' }, feedback: { type: 'string' }, question: { type: 'string' },
        done: { type: 'boolean' }, summary: { type: 'string' }, overall: { type: 'integer' }
    },
    required: ['score', 'feedback', 'question', 'done', 'summary', 'overall'],
    additionalProperties: false
};

/**
 * The whole interview so far, and what to do next: score the answer just
 * given (if any), then the next question, or the report when QUESTIONS are
 * done. The student's name, email, phone and Employee ID are never sent.
 */
const LEVEL_TEXT = {
    easy: 'Level: EASY. Ask about the core ideas behind each task, one step at a time, as for a first interview: someone who did the work should answer most of them. Still mark strictly.',
    medium: 'Level: MEDIUM. Ask as in a real interview for a junior developer: the ideas, "how would you" and the trade-offs behind the tasks.',
    hard: 'Level: HARD. Ask as a senior engineer hiring for a demanding role: failure cases, trade-offs, debugging under pressure and scaling, and dig into every weak or vague answer.'
};

function interviewPrompt({ domain, context, topics, turns, answer, number, difficulty }) {
    const last = turns.length ? turns[turns.length - 1] : null;
    const history = turns.slice(0, -1).map((t, i) => `Q${i + 1}: ${t.question}\nA${i + 1}: ${t.answer || '(no answer)'} (score ${t.score == null ? '-' : t.score}/10)`).join('\n');
    const finishing = number > QUESTIONS;
    return [
        `You are TEN's AI interviewer for an intern in the ${domain || 'software'} internship: an AI, not a person. ` +
        "This is the intern's technical interview and it counts towards their record, so be professional and precise. " +
        'Plain Indian English, short sentences, no small talk, no hints, no praise before an answer is judged.',
        LEVEL_TEXT[difficulty] || LEVEL_TEXT.medium,
        `About the intern (no personal details):\n${context}`,
        (topics || []).length
            ? `The tasks the intern has been given so far, which are the topics of this interview:\n${topics.map((t) => `- ${t}`).join('\n')}`
            : 'No task list is available; interview on the fundamentals of this domain.',
        'Ask about the ideas, trade-offs, failure cases and debugging behind those tasks, never the task text itself: what an interviewer asks someone who claims to have done this work. ' +
        'Every question tests one thing and has a checkable answer. Mix concepts, "how would you" and "what breaks if"; when an answer was weak or vague, the next question digs into it.',
        history ? `Interview so far:\n${history}` : (answer ? '' : 'The interview is starting.'),
        last && answer ? `Q${turns.length}: ${last.question}\nThe intern's answer, spoken aloud and transcribed, so ignore small transcription slips:\n"${last.answer}"` : '',
        last && answer ? 'Score it from 0 to 10, strictly: 10 is complete, correct and well organised; 5 is partly right; 0 is wrong, empty or off the point. ' +
            'Feedback in at most two sentences: what was missing or wrong, then what a strong answer includes.' : '',
        finishing
            ? `That was question ${QUESTIONS} of ${QUESTIONS}. Set done to true, leave question empty, and write the report in at most five sentences: ` +
              'the strengths, the gaps, and two concrete things to work on before the next interview. Give an overall mark from 0 to 10 consistent with the scores.'
            : `Now ask question ${number} of ${QUESTIONS}: one question, under 40 words, no multi-part questions, on a topic not asked yet unless it is a follow-up to a weak answer. Set done to false.`,
        'Answer with JSON: "score", "feedback", "question", "done", "summary", "overall".'
    ].filter(Boolean).join('\n\n');
}

// The page's camera totals since its last answer, as they may be stored: numbers only, bounded.
// The page sends what it counted since the last answer, and the session sums them, so a
// reload mid-interview loses only the seconds since that answer.
const PROCTOR_KEYS = ['attentiveMs', 'awayMs', 'noFaceMs', 'awayEpisodes', 'multiFaceEpisodes', 'cameraOffEpisodes'];
function proctorOf(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const out = { checker: raw.checker === 'mediapipe' ? 'mediapipe' : 'unavailable' };
    for (const k of PROCTOR_KEYS) out[k] = Math.max(0, Math.min(1e8, Math.round(Number(raw[k]) || 0)));
    return out;
}
function addProctor(sofar, delta) {
    if (!delta) return sofar || null;
    const out = Object.assign({}, delta);
    for (const k of PROCTOR_KEYS) out[k] = (sofar ? sofar[k] || 0 : 0) + delta[k];
    return out;
}

/** One line for the report: how much of the interview the camera saw the student's eyes on it. */
function attentionText(p) {
    if (!p) return 'Camera totals were not received.';
    if (p.checker !== 'mediapipe') return 'Camera on; the attention check was not available on this device.';
    const total = p.attentiveMs + p.awayMs + p.noFaceMs;
    const pct = total ? Math.round((100 * p.attentiveMs) / total) : 0;
    return `Eyes on the camera ${pct}% of the time; looked away ${p.awayEpisodes} time(s); face out of frame ${Math.round(p.noFaceMs / 1000)} s` +
        (p.multiFaceEpisodes ? `; another face seen ${p.multiFaceEpisodes} time(s)` : '') +
        (p.cameraOffEpisodes ? `; camera off ${p.cameraOffEpisodes} time(s)` : '') + '.';
}

const answered = (s) => s.turns.filter((t) => t.answer);
const marksOf = (s) => ({ got: answered(s).reduce((a, t) => a + (t.score || 0), 0), of: answered(s).length * 10 });
const levelName = (d) => (d ? d[0].toUpperCase() + d.slice(1) : 'Medium');
const view = (s) => ({
    id: String(s._id), domain: s.domain, startedAt: s.startedAt, endedAt: s.endedAt, overall: s.overall, summary: s.summary,
    difficulty: s.difficulty || 'medium', trial: !!s.trial,
    marks: marksOf(s), attention: attentionText(s.proctor), emailed: !!s.emailed,
    questions: s.turns.length, turns: s.turns.map((t) => ({ question: t.question, answer: t.answer, score: t.score, feedback: t.feedback, seconds: t.seconds || 0 }))
});

async function turnsToday(employeeId) {
    return AiCoordinatorLog.countDocuments({
        employeeId, kind: 'meeting', source: { $in: ['interview'] }, createdAt: { $gte: istDayStart(istDateKey()) }
    });
}

function log(student, source, question, reply) {
    return AiCoordinatorLog.create({
        kind: 'meeting', employeeId: student.employeeId || '', studentId: student._id || null, domain: student.domain || '',
        question: clean(question, 1000), reply: clean(reply, 2000), source
    }).catch((err) => console.error('[ai-meeting] log failed:', err.message));
}

// ── Which AI: the admin portal's choice ──────────────────────────────────

const SETTING_ID = 'interview';
const monthStart = (now = new Date()) => new Date(`${istDateKey(now).slice(0, 7)}-01T00:00:00Z`.replace('Z', '+05:30'));

async function settings() {
    const doc = await InterviewSetting.findById(SETTING_ID).lean();
    return Object.assign({ engine: 'gemini', claudeModel: 'claude-opus-5-5', claudeMonthlyCap: 50 }, doc || {});
}

const claudeThisMonth = () => MeetingSession.countDocuments({ engine: 'claude', startedAt: { $gte: monthStart() } });

/** What the admin portal shows: the choice, what each choice costs, and whether each AI can run. */
async function aiSummary() {
    const s = await settings();
    return {
        engine: s.engine, claudeModel: s.claudeModel, claudeMonthlyCap: s.claudeMonthlyCap,
        updatedAt: s.updatedAt || null, updatedBy: s.updatedBy || '',
        geminiReady: gemini.ready(), claudeReady: claude.ready(), claudeThisMonth: await claudeThisMonth(),
        models: claude.MODELS.map((id) => ({ id, costPerInterviewInr: CLAUDE_COST_INR[id] }))
    };
}

async function saveAiSettings({ engine, claudeModel, claudeMonthlyCap, by }) {
    if (!['gemini', 'claude'].includes(engine)) return { error: 'Choose Gemini or Claude.' };
    if (!claude.MODELS.includes(claudeModel)) return { error: 'Choose a Claude model from the list.' };
    const cap = Number(claudeMonthlyCap);
    if (!Number.isInteger(cap) || cap < 0 || cap > 100000) return { error: 'The monthly limit is a whole number from 0 to 100000.' };
    await InterviewSetting.findByIdAndUpdate(SETTING_ID, { $set: { engine, claudeModel, claudeMonthlyCap: cap, updatedBy: String(by || '').slice(0, 80) } },
        { upsert: true, new: true, setDefaultsOnInsert: true });
    return aiSummary();
}

/** The AI a new interview runs on: Claude when chosen, set up and under the month's limit; Gemini otherwise. */
async function engineForNew() {
    const s = await settings();
    if (s.engine === 'claude' && claude.ready() && await claudeThisMonth() < s.claudeMonthlyCap) return { engine: 'claude', model: s.claudeModel };
    return { engine: 'gemini', model: '' };
}

/** One turn. A turn Claude fails is answered by Gemini, so the student is not left waiting. */
async function askAI(student, prompt, use) {
    if (!(use.engine === 'claude' ? claude.ready() || gemini.ready() : gemini.ready())) {
        return { error: 'The AI is not set up on this server yet. Tell your coordinator in Messages.' };
    }
    if (await turnsToday(student.employeeId) >= TURNS_PER_DAY) {
        return { error: 'The AI has answered you many times today. It picks up again tomorrow; your coordinator is in Messages if it cannot wait.' };
    }
    if (use.engine === 'claude' && claude.ready()) {
        try {
            return { out: await claude.ask(prompt, CLAUDE_SCHEMA, use.model) };
        } catch (err) {
            console.warn('[ai-meeting] Claude did not answer; asking Gemini:', err.message);
        }
    }
    if (!gemini.ready()) return { error: BUSY };
    try {
        return { out: await gemini.ask(prompt, SCHEMA) };
    } catch (err) {
        console.warn('[ai-meeting] Gemini did not answer:', err.message);
        return { error: BUSY };
    }
}

// ── The interview ────────────────────────────────────────────────────────

/** A new interview at the chosen level and its first question, or the question an unfinished one stopped at. */
async function startInterview({ student, difficulty }) {
    const when = schedule();
    const open = await openSessionOf(student);
    if (open) {
        const last = open.turns[open.turns.length - 1];
        return { sessionId: String(open._id), question: last.question, number: open.turns.length, of: QUESTIONS, difficulty: open.difficulty, resumed: true };
    }
    if (!when.trial && await used(student)) return { error: 'You have taken your interview. Your report is on this page and in your email.', closed: true };
    if (!when.open) return { error: `The interview opens every second Sunday. Next: ${longDate(when.next)} (IST).`, closed: true };
    if (!LEVELS.includes(difficulty)) return { error: 'Choose easy, medium or hard first.' };
    const use = await engineForNew();
    const [context, topics] = await Promise.all([ai.contextFor(student, student.domain, {}), topicsFor(student)]);
    const r = await askAI(student, interviewPrompt({ domain: student.domain, context, topics, turns: [], number: 1, difficulty }), use);
    if (r.error) return { error: r.error };
    const question = clean(r.out.question, 400);
    if (!question) return { error: BUSY };
    const session = await MeetingSession.create({
        studentId: student._id, employeeId: student.employeeId, domain: student.domain || '', topics, turns: [{ question }],
        difficulty, engine: use.engine, claudeModel: use.model, trial: when.trial
    });
    await log(student, 'interview', 'start', question);
    return { sessionId: String(session._id), question, number: 1, of: QUESTIONS, difficulty };
}

async function openSession(student, sessionId) {
    if (!mongoose.Types.ObjectId.isValid(String(sessionId))) return null;
    return MeetingSession.findOne({ _id: sessionId, studentId: student._id, endedAt: null });
}

/** The end: the report is saved, logged for the daily report, and emailed to the student. */
async function close(student, session, { summary, overall }) {
    session.endedAt = new Date();
    session.summary = summary;
    session.overall = overall;
    session.emailed = await emailReport(student, session);
    await session.save();
    await log(student, 'report', `${answered(session).length} of ${QUESTIONS} answered, ${session.difficulty || 'medium'}, ${session.engine || 'gemini'}${session.trial ? ', trial' : ''}`,
        `overall ${session.overall == null ? '-' : session.overall}/10. ${attentionText(session.proctor)}`);
    return view(session);
}

/** The student's answer: its score and feedback, then the next question or the report. */
async function answerInterview({ student, sessionId, answer, seconds, proctor }) {
    const session = await openSession(student, sessionId);
    if (!session) return { error: 'This interview is over.' };
    const said = clean(answer, 3000);
    if (!said) return { error: 'Say or type your answer first.' };
    const last = session.turns[session.turns.length - 1];
    if (last.answer) return { error: 'That question is already answered. Wait for the next one.' };
    const context = await ai.contextFor(student, student.domain, {});
    // Stored scrubbed: a phone number or address said aloud never reaches the AI,
    // neither now nor in the transcript of the next question.
    last.answer = ai.scrub(said);
    last.seconds = Math.max(0, Math.min(36000, Math.round(Number(seconds) || 0)));
    session.proctor = addProctor(session.proctor, proctorOf(proctor));
    const number = session.turns.length + 1;
    const prompt = interviewPrompt({ domain: session.domain, context, topics: session.topics, turns: session.turns, answer: said, number, difficulty: session.difficulty });
    const r = await askAI(student, prompt, { engine: session.engine || 'gemini', model: session.claudeModel || '' });
    if (r.error) { last.answer = ''; return { error: r.error }; }
    const out = r.out || {};
    const mark = (v) => (Number.isFinite(Number(v)) ? Math.max(0, Math.min(10, Math.round(Number(v)))) : null);
    last.score = mark(out.score);
    last.feedback = clean(out.feedback, 600);
    await log(student, 'interview', last.question, `score ${last.score}: ${last.feedback}`);
    const next = number > QUESTIONS || out.done ? '' : clean(out.question, 400);
    if (!next) {
        const report = await close(student, session, { summary: clean(out.summary, 1500), overall: mark(out.overall) ?? average(session.turns) });
        return { score: last.score, feedback: last.feedback, question: null, number: QUESTIONS, of: QUESTIONS, done: true, report };
    }
    session.turns.push({ question: next });
    await session.save();
    return { score: last.score, feedback: last.feedback, question: next, number, of: QUESTIONS, done: false, report: null };
}

const average = (turns) => {
    const scores = turns.map((t) => t.score).filter((s) => typeof s === 'number');
    return scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null;
};

/** The report from what was answered, with no AI call: the student stopped, or left one open from an earlier day. */
async function finishSession(student, session, proctor) {
    if (!session.turns[session.turns.length - 1].answer) session.turns.pop();
    session.proctor = addProctor(session.proctor, proctorOf(proctor));
    const n = answered(session).length;
    const overall = average(session.turns);
    const summary = n
        ? `You stopped after ${n} of ${QUESTIONS} questions, averaging ${overall}/10; the unanswered questions count as not attempted.`
        : 'You stopped before answering any question.';
    return close(student, session, { summary, overall });
}

/** The student stops early. */
async function finishInterview({ student, sessionId, proctor }) {
    const session = await openSession(student, sessionId);
    if (!session) return { error: 'This interview is over.' };
    return { report: await finishSession(student, session, proctor) };
}

/** The student's finished interviews, newest first. */
async function reports({ student }) {
    const rows = await MeetingSession.find({ studentId: student._id, endedAt: { $ne: null } }).sort({ startedAt: -1 }).limit(10).lean();
    return rows.map(view);
}

// ── The report by email ─────────────────────────────────────────────────

async function emailReport(student, session) {
    try {
        const mail = require('../utils/mailer');
        if (!mail.mailerReady() || !mail.isSendableAddress(student.email)) return false;
        const e = mail.escapeHtml;
        const rows = answered(session).map((t, i) =>
            `<tr><td style="padding:8px 8px 0 0;vertical-align:top;color:#cdb24a;">${i + 1}.</td>` +
            `<td style="padding:8px 0 0;">${e(t.question)}<br><span style="color:#9a9080;font-size:13px;">${e(t.feedback || 'No feedback.')}</span></td>` +
            `<td align="right" style="padding:8px 0 0 10px;vertical-align:top;white-space:nowrap;"><b>${t.score == null ? '–' : t.score}/10</b></td></tr>`).join('');
        const m = marksOf(session);
        const overall = session.overall == null ? '–' : session.overall;
        const level = levelName(session.difficulty);
        await mail.createEmailTransporter().sendMail({
            from: mail.EMAIL_FROM,
            to: student.email,
            subject: `Your interview marks: ${overall}/10, ${level} (${longDate(istDateKey(session.startedAt))})`,
            html: mail.renderEmail({
                heading: 'Your interview report',
                name: nameOf(student),
                bodyHtml: `<p style="margin:0 0 10px;">Level: <b>${level}</b>. Overall mark: <b style="font-size:20px;">${overall}/10</b> (${m.got} of ${m.of} across ${m.of / 10} question${m.of === 10 ? '' : 's'}).</p>` +
                    `<p style="margin:0 0 10px;"><b>What to improve before the next interview:</b> ${e(session.summary)}</p>` +
                    `<p style="margin:0;color:#9a9080;font-size:13px;">Camera: ${e(attentionText(session.proctor))}</p>`,
                panel: { label: 'QUESTION BY QUESTION', html: `<table cellspacing="0" cellpadding="0" style="width:100%;font-size:14px;">${rows}</table>` },
                cta: { label: 'Open the Interview Room', url: mail.PORTAL_URL + '/meeting' },
                footerWhy: 'You took an interview in the TEN Interview Room. The interviewer is an AI; TEN keeps a copy of your marks.'
            })
        });
        return true;
    } catch (err) {
        console.error('[ai-meeting] report email failed:', err.message);
        return false;
    }
}

module.exports = {
    schedule, status, startInterview, answerInterview, finishInterview, reports, aiSummary, saveAiSettings, QUESTIONS, TURNS_PER_DAY, LEVELS,
    _internal: { interviewPrompt, topicsFor, proctorOf, addProctor, attentionText, average, engineForNew, monthStart, BUSY, ANCHOR, EVERY_DAYS, CLAUDE_COST_INR, CLAUDE_SCHEMA }
};
