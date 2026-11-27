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
 *              is scored out of 10 for its ideas, not its wording (partial marks
 *              for the right keywords and direction), with two sentences of feedback.
 *   Camera     required. The page checks, in the browser, that one face is in
 *              frame with its eyes on the camera, pauses the interview while it
 *              is not, and sends the running totals with each answer; they are
 *              kept with the session and go into the report. An answer sent
 *              without the face check running is refused. Leaving the
 *              interview window, or holding a phone or notes up to the camera,
 *              is a warning recorded here (warnInterview); the third ends the
 *              interview with the report of what was answered. ponytail:
 *              client-reported; checking the video on the server would cost
 *              money and the room must stay at ₹0.
 *   Report     a mark per question, an overall mark, the strengths, the gaps
 *              and what to work on before the next interview, and for each
 *              question what the student said beside the actual answer (the
 *              AI writes it while marking, with code when the question is
 *              about code). Saved (models/MeetingSession.js), shown on the
 *              page, emailed to the student with the course offer
 *              (courseOffer), and counted in the daily report.
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
 * Listening happens in the browser (Web Speech API). Speaking: the
 * interviewer's lines are written here (spokenLine) and voiced by Amazon
 * Polly's Indian-English neural voice when the AWS_POLLY keys are set
 * (utils/speech.js), otherwise by the device's own voice. It is an AI and says so;
 * a person can still overrule a mark.
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
const speech = require('../utils/speech');
const { istDayStart, istDateKey, IST_OFFSET_MS } = require('../utils/dateKey');
const ai = require('./aiCoordinator');

/** Questions in one interview. */
const QUESTIONS = 8;
/** AI turns per student per day in the room; one interview is QUESTIONS + 1. */
const TURNS_PER_DAY = 20;
const LEVELS = ['easy', 'medium', 'hard'];
/**
 * What one Claude interview costs, for the admin portal: about 30,000 tokens
 * in and 5,500 out over nine turns (the model answer for the report is most of
 * the output), at Anthropic's prices per million tokens (input / output:
 * Haiku 5.5 $0.10 / $0.50, Sonnet 5.5 $2 / $10, Opus 5.5 $4 / $20) and ₹85 to
 * the dollar. ponytail: an estimate from the prompt sizes; Anthropic's console
 * shows the real spend.
 */
const CLAUDE_COST_INR = { 'claude-haiku-5-5': 0.5, 'claude-sonnet-5-5': 10, 'claude-opus-5-5': 20 };
/** The first interview Sunday (IST). Every EVERY_DAYS days after it is another. */
const ANCHOR = '2026-11-29';
const EVERY_DAYS = 14;
const DAY_MS = 86400000;
const BUSY = 'The AI is busy right now. Try again in a minute; your interview continues where it stopped.';
const NO_FACE_CHECK = 'The face check is not running, so the answer was not taken. Reload the page with your camera on and continue.';
/** Warnings that end an interview, and what each kind is called in the report. */
const WARNINGS_TO_END = 3;
const WARNING_TEXT = { left: 'left the interview window', object: 'held a phone or notes up to the camera' };

const clean = (s, max) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, max);
// As clean, but keeping line breaks: a model answer may carry a few lines of code.
const answerText = (s, max) => String(s || '').replace(/\r/g, '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, max);
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
        warnings: open ? (open.warnings || []).length : 0,
        warningsToEnd: WARNINGS_TO_END,
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
        ideal: { type: gemini.Type.STRING },
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
        score: { type: 'integer' }, feedback: { type: 'string' }, ideal: { type: 'string' }, question: { type: 'string' },
        done: { type: 'boolean' }, summary: { type: 'string' }, overall: { type: 'integer' }
    },
    required: ['score', 'feedback', 'ideal', 'question', 'done', 'summary', 'overall'],
    additionalProperties: false
};

/**
 * The whole interview so far, and what to do next: score the answer just
 * given (if any), then the next question, or the report when QUESTIONS are
 * done. The student's name, email, phone and Employee ID are never sent.
 */
const LEVEL_TEXT = {
    easy: 'Level: EASY. Ask about the core ideas behind each task, one step at a time, as for a first interview: someone who did the work should answer most of them.',
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
        last && answer ? 'Score it from 0 to 10 for the ideas, not the wording. The intern speaks in their own words, so never expect a textbook answer word for word, ' +
            'and ignore filler words, grammar and transcription slips. Give credit for every correct point: ' +
            'an answer that names the key idea or the main keywords and is heading the right way earns 3 to 5 even if it is incomplete; ' +
            'the right idea explained in their own words, 6 to 7; correct with an example, a reason or a trade-off, 8 to 9; complete and well organised, 10. ' +
            'Give 0 to 2 only when the answer is wrong, empty or off the point. Between two marks, give the higher one. ' +
            'Feedback in at most two sentences: what was right or missing, then what a strong answer includes. ' +
            'In "ideal", write the actual answer to that question as a strong candidate would say it: correct, specific, at most five sentences, ' +
            'stated as the answer itself, not as advice. When the question is about code, include the few lines of code that answer it, one statement per line.' : '',
        finishing
            ? `That was question ${QUESTIONS} of ${QUESTIONS}. Set done to true, leave question empty, and write the report in at most five sentences: ` +
              'the strengths, the gaps, and two concrete things to work on before the next interview. Give an overall mark from 0 to 10 consistent with the scores.'
            : `Now ask question ${number} of ${QUESTIONS}: one question, under 40 words, no multi-part questions, on a topic not asked yet unless it is a follow-up to a weak answer. Set done to false.`,
        'Answer with JSON: "score", "feedback", "ideal", "question", "done", "summary", "overall".'
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

// ── What the interviewer says ────────────────────────────────────────────
// The page shows the question and speaks these lines: Polly's voice when it is
// set up (voiceOf), the device's voice otherwise. Fixed lines, so a student
// cannot have the paid-for voice read out text of their own.
const SAMPLE_LINE = 'Hello. I am your TEN interviewer. A question will sound like this: your API returned the right data in testing, but times out in production. Where do you look first, and why?';
const END_LINE = 'That brings us to the end of the interview. Thank you for your time. Your report is on the screen now, and a copy is on its way to your email.';
const ACKS = ['Thank you.', 'Alright, thank you.', 'Okay. Let us move on.', 'Thank you for that.', 'Understood.', 'Right. Next one.', 'Thank you.'];
/** Morning, afternoon or evening in India, for the greeting. */
function partOfDay(now = new Date()) {
    const h = new Date(now.getTime() + IST_OFFSET_MS).getUTCHours();
    return h < 12 ? 'morning' : h < 17 ? 'afternoon' : 'evening';
}
// greet / back: the welcome when the student joins or rejoins, ending with "How are
// you doing today?"; the page waits for the student's reply (not marked, not kept).
// begin: after that reply, the format and the question they start on. ack: the
// acknowledgement of an answer and the next question.
const LEADS = ['greet', 'back', 'begin', 'ack'];
function spokenLine(session, student, n, lead) {
    const turn = session.turns[n - 1];
    if (!turn || !turn.question) return '';
    const first = nameOf(student).split(' ')[0];
    const level = levelName(session.difficulty);
    const domain = session.domain || 'your domain';
    if (lead === 'greet') return `Hi ${first}, good ${partOfDay()}. I am your TEN interviewer for today's ${level} level interview in ${domain}. How are you doing today?`;
    if (lead === 'back') return `Hi ${first}, good ${partOfDay()}, and welcome back to your ${level} level interview. How are you doing?`;
    const opening = lead !== 'begin' ? ACKS[Math.max(0, n - 2) % ACKS.length]
        : n === 1 ? `Thank you, ${first}. Over the next twenty minutes, I will ask you ${QUESTIONS} questions on the work you have done in your internship. ` +
            'Take a moment to think before each answer, and answer in your own words. Okay, let us start with the interview.'
        : `Thank you, ${first}. Let us continue from question ${n}, where we stopped.`;
    return `${opening} ${n === QUESTIONS ? 'The last question.' : `Question ${n}.`} ${turn.question}`;
}

// ponytail: per-process memory, newest kept; enough to replay a line or survive a reload.
const voiceCache = new Map();
/** MP3 of one interviewer line, or null when the natural voice is off or Polly refused. */
async function voiceOf({ student, sessionId, n, lead, part }) {
    if (!speech.ready()) return null;
    let key, text;
    if (part === 'sample' || part === 'end') {
        key = part;
        text = part === 'sample' ? SAMPLE_LINE : END_LINE;
    } else {
        if (!mongoose.Types.ObjectId.isValid(String(sessionId))) return null;
        const session = await MeetingSession.findOne({ _id: sessionId, studentId: student._id }).lean();
        const num = Math.round(Number(n));
        const why = LEADS.includes(lead) ? lead : 'ack';
        text = session && spokenLine(session, student, num, why);
        if (!text) return null;
        key = `${sessionId}:${num}:${why}`;
    }
    if (voiceCache.has(key)) return voiceCache.get(key);
    const audio = await speech.speak(text);
    if (audio) {
        voiceCache.set(key, audio);
        if (voiceCache.size > 200) voiceCache.delete(voiceCache.keys().next().value);
    }
    return audio;
}
/** For the page: whether the natural voice is on, and the fixed lines for the device voice. */
const voiceInfo = () => ({ natural: speech.ready(), name: speech.voice(), sample: SAMPLE_LINE, end: END_LINE });

/** One line for the report: the warnings, or nothing. */
function warningText(warnings) {
    const n = (warnings || []).length;
    if (!n) return '';
    const by = Object.keys(WARNING_TEXT).map((k) => [k, warnings.filter((w) => w.kind === k).length]).filter(([, c]) => c)
        .map(([k, c]) => `${WARNING_TEXT[k]} ${c} time(s)`);
    return ` Warnings: ${n} of ${WARNINGS_TO_END} (${by.join('; ')}).`;
}
const cameraLine = (s) => attentionText(s.proctor) + warningText(s.warnings);

const answered = (s) => s.turns.filter((t) => t.answer);
const marksOf = (s) => ({ got: answered(s).reduce((a, t) => a + (t.score || 0), 0), of: answered(s).length * 10 });
const levelName = (d) => (d ? d[0].toUpperCase() + d.slice(1) : 'Medium');
const view = (s) => ({
    id: String(s._id), domain: s.domain, startedAt: s.startedAt, endedAt: s.endedAt, overall: s.overall, summary: s.summary,
    difficulty: s.difficulty || 'medium', trial: !!s.trial,
    marks: marksOf(s), attention: cameraLine(s), warnings: (s.warnings || []).length, emailed: !!s.emailed,
    questions: s.turns.length, turns: s.turns.map((t) => ({ question: t.question, answer: t.answer, score: t.score, feedback: t.feedback, ideal: t.ideal || '', seconds: t.seconds || 0 }))
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
        return { sessionId: String(open._id), question: last.question, number: open.turns.length, of: QUESTIONS, difficulty: open.difficulty, resumed: true,
            greeting: spokenLine(open, student, open.turns.length, 'back'), say: spokenLine(open, student, open.turns.length, 'begin') };
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
    return { sessionId: String(session._id), question, number: 1, of: QUESTIONS, difficulty,
        greeting: spokenLine(session, student, 1, 'greet'), say: spokenLine(session, student, 1, 'begin') };
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
        `overall ${session.overall == null ? '-' : session.overall}/10. ${cameraLine(session)}`);
    return view(session);
}

/** The student's answer: its score and feedback, then the next question or the report. */
async function answerInterview({ student, sessionId, answer, seconds, proctor }) {
    const counted = proctorOf(proctor);
    if (!counted || counted.checker !== 'mediapipe') return { error: NO_FACE_CHECK };
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
    session.proctor = addProctor(session.proctor, counted);
    const number = session.turns.length + 1;
    const prompt = interviewPrompt({ domain: session.domain, context, topics: session.topics, turns: session.turns, answer: said, number, difficulty: session.difficulty });
    const r = await askAI(student, prompt, { engine: session.engine || 'gemini', model: session.claudeModel || '' });
    if (r.error) { last.answer = ''; return { error: r.error }; }
    const out = r.out || {};
    const mark = (v) => (Number.isFinite(Number(v)) ? Math.max(0, Math.min(10, Math.round(Number(v)))) : null);
    last.score = mark(out.score);
    last.feedback = clean(out.feedback, 600);
    last.ideal = answerText(out.ideal, 1500);
    await log(student, 'interview', last.question, `score ${last.score}: ${last.feedback}`);
    const next = number > QUESTIONS || out.done ? '' : clean(out.question, 400);
    if (!next) {
        const report = await close(student, session, { summary: clean(out.summary, 1500), overall: mark(out.overall) ?? average(session.turns) });
        return { score: last.score, feedback: last.feedback, question: null, number: QUESTIONS, of: QUESTIONS, done: true, report, say: END_LINE };
    }
    session.turns.push({ question: next });
    await session.save();
    return { score: last.score, feedback: last.feedback, question: next, number, of: QUESTIONS, done: false, report: null, say: spokenLine(session, student, number, 'ack') };
}

const average = (turns) => {
    const scores = turns.map((t) => t.score).filter((s) => typeof s === 'number');
    return scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null;
};

/** The report from what was answered, with no AI call: the student stopped, or left one open from an earlier day. */
async function finishSession(student, session, proctor, reason) {
    if (!session.turns[session.turns.length - 1].answer) session.turns.pop();
    session.proctor = addProctor(session.proctor, proctorOf(proctor));
    const n = answered(session).length;
    const overall = average(session.turns);
    const summary = (reason ? reason + ' ' : '') + (n
        ? `You stopped after ${n} of ${QUESTIONS} questions, averaging ${overall}/10; the unanswered questions count as not attempted.`
        : 'You stopped before answering any question.');
    return close(student, session, { summary, overall });
}

/**
 * The page caught the student leaving the interview window or holding a phone
 * or notes up to the camera. Kept on the session, so a reload does not reset
 * the count; the third warning ends the interview with what was answered.
 */
async function warnInterview({ student, sessionId, kind, proctor }) {
    if (!WARNING_TEXT[kind]) return { error: 'Unknown warning.' };
    const session = await openSession(student, sessionId);
    if (!session) return { error: 'This interview is over.' };
    session.warnings = (session.warnings || []).concat({ kind, at: new Date() });
    const count = session.warnings.length;
    if (count >= WARNINGS_TO_END) {
        const report = await finishSession(student, session, proctor, `The interview was ended after ${WARNINGS_TO_END} warnings.`);
        return { warnings: count, of: WARNINGS_TO_END, ended: true, report };
    }
    await session.save();
    return { warnings: count, of: WARNINGS_TO_END, ended: false };
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

/**
 * The course offer under the report. A student who has the course (bought, or
 * included with a paid internship) is sent back to it; anyone else is told what
 * it covers and what it costs, from config/studioPricing.js.
 */
async function courseOffer(student, session) {
    const domain = session.domain || student.domain || 'your domain';
    const n = answered(session).length;
    const weak = answered(session).filter((t) => (t.score || 0) < 6).length;
    let owned = false;
    try {
        const access = await require('./studioAccess').getStudioAccess(student);
        owned = !!(access.portals.course && access.portals.course.granted);
    } catch (err) {
        console.error('[ai-meeting] course access lookup failed:', err.message);
    }
    if (owned) {
        return {
            owned, url: '/learn', label: 'Continue your course',
            text: `You already have the TEN course for ${domain}. ` +
                (weak ? `Go back to the topics behind the ${weak} question${weak === 1 ? '' : 's'} where you scored below 6, and take those topic exams again. ` : 'Keep going through the modules and their exams. ') +
                'That is the quickest way to be job ready before your next interview.'
        };
    }
    const pricing = require('../config/studioPricing');
    const course = pricing.getProduct('course');
    const later = pricing.deferredPriceFor('course');
    return {
        owned, url: '/studio.html', label: 'Take the course',
        text: (weak
            ? `You scored below 6 on ${weak} of ${n} question${n === 1 ? '' : 's'}. If you want to upgrade yourself, take the TEN course for ${domain}: it teaches every one of these topics in depth, `
            : `You scored 6 or more on every question. If you want to go further, take the TEN course for ${domain}: it takes every topic deeper, `) +
            'with lessons, a video per topic, practice and proctored exams, and a certificate at the end. ' +
            'Learn there what you got stuck on, and walk into your next interview job ready.' +
            (course ? ` ₹${course.price}${later ? `, or ₹${later} if you pay when you finish` : ''}.` : '')
    };
}

// ponytail: a line looks like code by its punctuation and first word; a prose line
// that ends in ";" would be set as code too, which costs only the font.
const CODE_LINE = /[;{}]\s*$|=>|^\s*(const|let|var|if|for|while|return|await|async|function|def|class|import|from|SELECT|INSERT|UPDATE|DELETE|print|console\.)\b/;
/** The actual answer as email HTML: prose as text, runs of code lines in a monospace block. */
function answerHtml(text, e) {
    const out = []; let code = [];
    const flush = () => {
        if (code.length) out.push(`<div style="font-family:Consolas,Menlo,monospace;font-size:12.5px;line-height:1.55;background:#0b1020;border:1px solid rgba(245,197,66,0.12);border-radius:6px;padding:8px 10px;margin:6px 0;white-space:pre-wrap;">${e(code.join('\n'))}</div>`);
        code = [];
    };
    for (const line of String(text).split('\n')) {
        if (CODE_LINE.test(line)) { code.push(line); continue; }
        flush();
        if (line.trim()) out.push(`<div>${e(line)}</div>`);
    }
    flush();
    return out.join('');
}

/** The full report by email: the marks, how it went, each question with what was said and the actual answer, and the course. */
async function emailReport(student, session) {
    try {
        const mail = require('../utils/mailer');
        if (!mail.mailerReady() || !mail.isSendableAddress(student.email)) return false;
        const e = mail.escapeHtml;
        const m = marksOf(session);
        const overall = session.overall == null ? '–' : session.overall;
        const level = levelName(session.difficulty);
        const date = longDate(istDateKey(session.startedAt));
        const cut = (t, max) => (t.length > max ? t.slice(0, max - 1) + '…' : t);
        const label = (text, colour) => `<div style="font-size:11px;letter-spacing:1px;font-weight:700;color:${colour};margin-top:10px;">${text}</div>`;
        const questions = answered(session).map((t, i) =>
            `<div style="border-top:1px solid rgba(245,197,66,0.15);padding:14px 0 4px;">` +
            `<div style="font-size:11px;letter-spacing:1px;font-weight:700;color:#cdb24a;">QUESTION ${i + 1} · ${t.score == null ? '–' : t.score}/10</div>` +
            `<div style="font-weight:700;margin-top:4px;">${e(t.question)}</div>` +
            label('YOU SAID', '#9a9080') +
            `<div style="color:#cfcab9;white-space:pre-wrap;">“${e(cut(t.answer, 700))}”</div>` +
            (t.ideal
                ? label('THE ACTUAL ANSWER', '#34d399') + answerHtml(t.ideal, e)
                : label('NOTE', '#34d399') + `<div>${e(t.feedback || 'No note.')}</div>`) +
            '</div>').join('');
        const offer = await courseOffer(student, session);
        await mail.createEmailTransporter().sendMail({
            from: mail.EMAIL_FROM,
            to: student.email,
            subject: `Your interview report: ${overall}/10, ${level} (${date})`,
            html: mail.renderEmail({
                heading: 'Your interview report',
                name: nameOf(student),
                bodyHtml:
                    `<table cellspacing="0" cellpadding="0" style="width:100%;margin:0 0 14px;"><tr>` +
                    `<td style="vertical-align:middle;width:110px;font-size:44px;font-weight:800;color:#f5c542;line-height:1;">${overall}<span style="font-size:18px;color:#9a9080;">/10</span></td>` +
                    `<td style="vertical-align:middle;font-size:13.5px;color:#cfcab9;line-height:1.6;">${e(session.domain || 'Technical')} interview · <b>${level}</b> level<br>${date}<br>` +
                    `${m.got} of ${m.of} marks across ${m.of / 10} question${m.of === 10 ? '' : 's'}</td></tr></table>` +
                    label('HOW IT WENT', '#cdb24a') + `<p style="margin:4px 0 10px;">${e(session.summary)}</p>` +
                    `<p style="margin:0 0 16px;color:#9a9080;font-size:13px;">Camera: ${e(cameraLine(session))}</p>` +
                    (questions ? `<div style="font-size:11px;letter-spacing:2px;font-weight:700;color:#f5c542;margin-top:6px;">QUESTION BY QUESTION</div>${questions}` : ''),
                panel: { label: offer.owned ? 'KEEP GOING' : 'GET JOB READY', html: e(offer.text) },
                cta: { label: offer.label, url: mail.PORTAL_URL + offer.url },
                note: `Your report is also in the <a href="${mail.PORTAL_URL}/meeting" style="color:#cdb24a;">Interview Room</a>.`,
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
    schedule, status, startInterview, answerInterview, finishInterview, warnInterview, reports, aiSummary, saveAiSettings, voiceOf, voiceInfo, QUESTIONS, TURNS_PER_DAY, LEVELS, WARNINGS_TO_END,
    _internal: { interviewPrompt, topicsFor, proctorOf, addProctor, attentionText, warningText, average, courseOffer, answerText, answerHtml, engineForNew, monthStart, spokenLine, partOfDay, voiceCache, BUSY, NO_FACE_CHECK, ANCHOR, EVERY_DAYS, CLAUDE_COST_INR, CLAUDE_SCHEMA }
};
