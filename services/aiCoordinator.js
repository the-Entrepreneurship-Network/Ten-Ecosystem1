'use strict';

/**
 * The AI Coordinator's shared helpers: the on/off switch, its name, the
 * student's own record, the domain's coordinators, and the scrubber that keeps
 * contact details away from Gemini.
 *
 * The AI Coordinator does not chat with students. It works in the
 * background: it pre-checks and reviews submissions, approves finished
 * students for certificates, sends reminders and the coordinators' summary
 * (services/aiCoordinatorJobs.js, services/submissionPrecheck.js), and runs
 * the fortnightly Interview Room (services/aiMeeting.js). Its decisions are
 * labelled as its own and a coordinator can change them.
 *
 * server.js calls attach() once with the coordinator roster from .env, so
 * roster coordinators get the summary as well as database ones.
 */

const mongoose = require('mongoose');
const Coordinator = require('../models/Coordinator');
const Attendance = require('../models/Attendance');
const StudentTaskProgress = require('../models/new/StudentTaskProgress');
const DomainTask = require('../models/new/DomainTask');
const InterviewSetting = require('../models/InterviewSetting');
const AiCoordinatorLog = require('../models/AiCoordinatorLog');
const gemini = require('../utils/gemini');
const claude = require('../utils/claude');
const { getAttendanceSummary } = require('../utils/attendanceUtils');
const { filterByDomain } = require('../utils/attendanceDomain');
const { istDateKey } = require('../utils/dateKey');

const NAME = 'TEN AI Coordinator';
/*
 * Who its messages to students come from: the coordinator team it works for.
 * NAME stays its name where staff read it (an approver, the summaries). It
 * never signs as a person, and the student's card marks its reviews as
 * AI-assisted.
 */
const SENDER = 'TEN Coordinator Team';
const enabled = () => !/^(off|false|0|no)$/i.test(String(process.env.AI_COORDINATOR || 'on').trim());

let hooks = {};
function attach(opts = {}) { hooks = Object.assign({}, hooks, opts); }

// ── The student's own record ─────────────────────────────────────────────

/** Never sent to Gemini: addresses, UPI IDs and phone numbers typed into a question. */
const scrub = (s) => String(s || '')
    .replace(/[\w.+-]+@[\w.-]+/g, '[address]')
    .replace(/(\+?91[\s-]?)?\b[6-9]\d{9}\b/g, '[phone]')
    .replace(/\b\d{11,}\b/g, '[number]');

const day = (d) => (d ? new Date(d).toLocaleDateString('en-IN',
    { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' }) : '');

async function attendanceOf(student, domain) {
    const records = await Attendance.find({ employeeId: student.employeeId })
        .select('dateKey status domain markedBy').lean();
    return getAttendanceSummary(filterByDomain(records, domain || student.domain, student), student);
}

const STATUS_LABEL = {
    available: 'not started',
    in_progress: 'started',
    submitted: 'submitted, quiz not passed yet',
    rejected: 'sent back by the coordinator'
};

/**
 * Where the student is in the Task Journey, read-only.
 *
 * The current week is the lowest week with a task that is open but not
 * approved. A locked task belongs to a week that has not opened yet.
 */
async function progressOf(student) {
    const rows = await StudentTaskProgress.find({ studentId: student._id })
        .select('taskId status quiz_passed coordinatorFeedback approvedAt').lean();
    if (!rows.length) return { total: 0, approved: 0, week: null, current: [], approvedAt: [] };
    const tasks = await DomainTask.find({ _id: { $in: rows.map((r) => r.taskId) } })
        .select('taskTitle weekNumber').lean();
    const byId = new Map(tasks.map((t) => [String(t._id), t]));
    const list = rows.map((r) => Object.assign({}, r, { task: byId.get(String(r.taskId)) })).filter((r) => r.task);
    const open = list.filter((r) => r.status !== 'approved' && r.status !== 'locked');
    const week = open.length ? Math.min(...open.map((r) => r.task.weekNumber || 1)) : null;
    return {
        total: list.length,
        approved: list.filter((r) => r.status === 'approved').length,
        week,
        current: open.filter((r) => (r.task.weekNumber || 1) === week).map((r) => ({
            title: r.task.taskTitle, status: r.status, feedback: r.coordinatorFeedback || ''
        })),
        approvedAt: list.filter((r) => r.status === 'approved' && r.approvedAt).map((r) => new Date(r.approvedAt))
    };
}

/** The coordinators of a domain: database accounts and the roster's. */
async function coordinatorsFor(domain) {
    const wanted = String(domain || '').trim().toLowerCase();
    if (!wanted) return [];
    const rx = new RegExp('^' + wanted.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$', 'i');
    let db = [];
    try {
        db = await Coordinator.find({ domain: rx, verificationStatus: 'approved', supersededAt: null })
            .select('name email username domain').lean();
    } catch (err) { console.error('[ai-coordinator] coordinators:', err.message); }
    const people = db.map((c) => ({
        id: c.email || c.username, name: c.name || c.username || c.email, email: c.email || '', domain: c.domain
    }));
    for (const r of (hooks.roster && hooks.roster()) || []) {
        if (r.role !== 'coordinator' || String(r.domain || '').trim().toLowerCase() !== wanted) continue;
        if (people.some((p) => p.id === r.id)) continue;
        people.push({ id: r.id, name: r.name, email: /@/.test(r.id) ? r.id : '', domain: r.domain });
    }
    return people.filter((p) => p.id);
}

/** Every domain that has at least one coordinator, as the coordinators spell it. */
async function domainsWithCoordinators() {
    const out = new Map();
    try {
        for (const d of await Coordinator.distinct('domain', { verificationStatus: 'approved', supersededAt: null })) {
            if (d) out.set(String(d).trim().toLowerCase(), String(d).trim());
        }
    } catch (err) { console.error('[ai-coordinator] domains:', err.message); }
    for (const r of (hooks.roster && hooks.roster()) || []) {
        if (r.role === 'coordinator' && r.domain) out.set(String(r.domain).trim().toLowerCase(), String(r.domain).trim());
    }
    return Array.from(out.values());
}

async function contextFor(student, domain, values) {
    const lines = [`Domain: ${domain || 'not chosen yet'}`];
    if (!student) {
        lines.push('This person has no internship record yet: they may not have finished registering.');
        return lines.join('\n');
    }
    if (values.plan) lines.push(`Plan: ${values.plan}`);

    const att = await attendanceOf(student, domain).catch(() => null);
    if (att && att.startDate) {
        lines.push(`Internship: started ${day(att.startDate)}, ends ${day(att.endDate)} (day ${att.dayNumber}, ` +
            `${att.daysRemaining} days left).`);
        lines.push(`Attendance: ${att.percentage}% so far (${att.daysPresent} of ${att.workingDaysElapsed} working days; ` +
            'Monday to Saturday count; 75% is needed for the Letter of Completion' +
            (att.isEligible ? '' : `; ${att.stillNeedsByEnd} more present days are needed by the end`) +
            (att.canStillQualify ? '' : '; 75% can no longer be reached by the end date') + ').');
    }

    const p = await progressOf(student).catch(() => null);
    if (p && p.total) {
        lines.push(`Task Journey: ${p.approved} of ${p.total} tasks approved.` +
            (p.week ? ` Current week: ${p.week}. Passing a task's quiz approves it; a week opens when the week before is all approved.` : ''));
        for (const t of p.current.slice(0, 8)) {
            lines.push(`- Week ${p.week} task "${t.title}": ${STATUS_LABEL[t.status] || t.status}` +
                (t.status === 'rejected' && t.feedback ? ` (feedback: "${t.feedback.slice(0, 200)}")` : ''));
        }
    }

    try {
        const subs = await mongoose.model('Submission').find({ employeeId: student.employeeId })
            .sort({ submittedAt: -1 }).limit(5).select('task status feedback reviewedOnce').lean();
        for (const s of subs) {
            lines.push(`Submitted work "${String(s.task || 'a task').slice(0, 120)}": ${s.status || 'Pending'}` +
                (s.reviewedOnce && s.feedback && s.feedback !== 'No Feedback Yet' ? ` (coordinator's feedback: "${String(s.feedback).slice(0, 200)}")` : ''));
        }
    } catch (_) { /* Submission is registered by server.js; a test or script may not have it */ }

    for (const k of ['feeStatus', 'documentsStatus', 'offerLetterStatus', 'completionStatus']) {
        if (values[k]) lines.push(values[k]);
    }
    const coordinator = (await coordinatorsFor(domain))[0];
    if (coordinator) lines.push(`Their coordinator: ${coordinator.name}.`);
    return lines.join('\n');
}

// ── Which AI writes the reviews: the admin portal's choice ───────────────

/*
 * Gemini (free) or Claude (paid per review) for the submission pre-check and
 * the feedback the intern receives (services/submissionPrecheck.js). One
 * document, _id "coordinator", beside the Interview Room's in
 * models/InterviewSetting.js. Past the month's limit, without the key, or when
 * Claude does not answer, Gemini writes it, so a review never waits on Claude.
 */
const ENGINE_ID = 'coordinator';
/** ₹ a review, estimated: about 2,000 tokens in and 800 out at $0.10/$0.50, $2/$10 and $4/$20 a million, ₹90 to the dollar. */
const REVIEW_COST_INR = { 'claude-haiku-5-5': 0.1, 'claude-sonnet-5-5': 1.2, 'claude-opus-5-5': 2.5 };
const ENGINE_DEFAULTS = { engine: 'gemini', claudeModel: 'claude-sonnet-5-5', claudeMonthlyCap: 500 };
const monthStart = (now = new Date()) => new Date(istDateKey(now).slice(0, 7) + '-01T00:00:00+05:30');

async function engineSettings() {
    const doc = await InterviewSetting.findById(ENGINE_ID).lean();
    return Object.assign({}, ENGINE_DEFAULTS, doc || {});
}

/** Claude reviews this calendar month (IST), counted from the pre-check log. */
const claudeReviewsThisMonth = () => AiCoordinatorLog.countDocuments({ kind: 'precheck', engine: 'claude', createdAt: { $gte: monthStart() } });

/** What the admin portal shows: the choice, the cost of each model, and whether each AI can run. */
async function engineSummary() {
    const s = await engineSettings();
    return {
        engine: s.engine, claudeModel: s.claudeModel, claudeMonthlyCap: s.claudeMonthlyCap,
        updatedAt: s.updatedAt || null, updatedBy: s.updatedBy || '',
        geminiReady: gemini.ready(), claudeReady: claude.ready(), claudeThisMonth: await claudeReviewsThisMonth(),
        models: claude.MODELS.map((id) => ({ id, costPerReviewInr: REVIEW_COST_INR[id] }))
    };
}

async function saveEngine({ engine, claudeModel, claudeMonthlyCap, by }) {
    if (!['gemini', 'claude'].includes(engine)) return { error: 'Choose Gemini or Claude.' };
    if (!claude.MODELS.includes(claudeModel)) return { error: 'Choose a Claude model from the list.' };
    const cap = Number(claudeMonthlyCap);
    if (!Number.isInteger(cap) || cap < 0 || cap > 100000) return { error: 'The monthly limit is a whole number from 0 to 100000.' };
    await InterviewSetting.findByIdAndUpdate(ENGINE_ID, { $set: { engine, claudeModel, claudeMonthlyCap: cap, updatedBy: String(by || '').slice(0, 80) } },
        { upsert: true, new: true, setDefaultsOnInsert: true });
    return engineSummary();
}

/** Can any AI write a review on this server? */
const reviewerReady = () => gemini.ready() || claude.ready();

/**
 * One review's answer, { out, engine }, or null when no AI can write it:
 * Claude when chosen, set up and under the month's limit; Gemini otherwise,
 * and when Claude fails. Throws when the last AI asked fails.
 */
async function askReviewer(prompt, geminiSchema, claudeSchema) {
    const s = await engineSettings().catch(() => ENGINE_DEFAULTS);
    // A count that fails is read as the limit reached: the bill is never left open.
    if (s.engine === 'claude' && claude.ready() && await claudeReviewsThisMonth().catch(() => Infinity) < s.claudeMonthlyCap) {
        try {
            return { out: await claude.ask(prompt, claudeSchema, s.claudeModel), engine: 'claude' };
        } catch (err) {
            if (!gemini.ready()) throw err;
            console.warn('[ai-coordinator] Claude did not answer; asking Gemini:', err.message);
        }
    }
    if (!gemini.ready()) return null;
    return { out: await gemini.ask(prompt, geminiSchema), engine: 'gemini' };
}

module.exports = {
    NAME, SENDER, enabled, attach, coordinatorsFor, domainsWithCoordinators, progressOf, attendanceOf, scrub, contextFor,
    reviewerReady, askReviewer, engineSummary, saveEngine,
    // for tests
    _internal: { STATUS_LABEL }
};
