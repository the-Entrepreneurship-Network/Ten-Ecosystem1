'use strict';

/**
 * The AI Coordinator's scheduled work (Asia/Kolkata, worker 0 only):
 *
 *   10:05 every day   a reminder to students who have not signed in for 3 to
 *                     13 days: in the portal, on the phone, and by email unless
 *                     they unsubscribed. Longer than that, the Monday mail's
 *                     "inactive 14+ days" nudge already writes to them.
 *   10:05 Thursdays   a nudge about an unfinished week (portal and phone).
 *   10:05 Sundays     a weekly progress note (portal and phone).
 *   09:05 every day   a summary for each domain's coordinators: what is
 *                     waiting for review and who is under 75% attendance.
 *                     By email to coordinators with an address,
 *                     and in the dashboard's AI Assistant tab, always current.
 *   02:05 and 08:35,  every waiting submission, oldest first: a pre-check
 *   and on boot       where none is fresh, and, for those handed in within
 *                     the last 60 days, the AI's own review through the
 *                     coordinator's review path (a hand-in or resubmission is
 *                     decided right after its pre-check, and a coordinator can
 *                     change an AI decision): approved when every check
 *                     passed and the AI read it and found it the task, asked
 *                     for changes when a check failed or the AI asked for
 *                     them (not the task, or a main part missing). The rest
 *                     waits for a person and is named in the report. Then
 *                     the students whose internship ended in those 60 days
 *                     with 75% attendance and five approved tasks are
 *                     approved for certificate consideration, as the
 *                     coordinator's Students tab does it, and reach HR.
 *   10:20 every day   a report to the team inbox (SUPPORT_COPY_TO) of what the
 *                     AI did in the last 24 hours; also when a backlog run ends.
 *
 * Every reminder and summary has a key, written before it is sent, so a second
 * run or a restart never sends it twice. Nothing here costs money unless the
 * admin portal picks Claude for the reviews (paid, capped a month): the
 * pre-check uses Gemini's free tier by default, email goes through the
 * portal's own SMTP account, and the report through the help desk's mailbox.
 */

const cron = require('node-cron');
const mongoose = require('mongoose');
const Student = require('../models/Student');
const Attendance = require('../models/Attendance');
const LoginEvent = require('../models/LoginEvent');
const Notification = require('../models/Notification');
const MailHistory = require('../models/MailHistory');
const AiCoordinatorLog = require('../models/AiCoordinatorLog');
const { getEffectiveStartDate, getAttendanceSummary } = require('../utils/attendanceUtils');
const { filterByDomain } = require('../utils/attendanceDomain');
const { getInternshipEndDate } = require('../utils/tenure');
const { istDateKey } = require('../utils/dateKey');
const mailer = require('../utils/mailer');
const ai = require('./aiCoordinator');
const precheck = require('./submissionPrecheck');

const DAY = 24 * 3600 * 1000;
const INACTIVE_FROM = 3;
const INACTIVE_UNTIL = 14;
/** At most this many reminders of one kind a day; the rest wait for tomorrow. */
const MAX_PER_RUN = 300;

const domainRx = (d) => new RegExp('^' + String(d || '').trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$', 'i');
const nameOf = (s) => (s && (s.name || [s.firstName, s.lastName].filter(Boolean).join(' ').trim())) || (s && s.employeeId) || '';
const latest = (...dates) => dates.filter(Boolean).map((d) => new Date(d)).filter((d) => !isNaN(d)).sort((a, b) => b - a)[0] || null;

/** Students whose internship is running today (the rule automationCron uses). */
async function runningStudents(now = new Date(), filter = {}) {
    const students = await Student.find(Object.assign({
        $and: [
            { $or: [{ internshipEndDate: { $gte: now } }, { internshipEndDate: null }, { internshipEndDate: { $exists: false } }] },
            { internshipCompleted: { $ne: true } }
        ]
    }, filter)).lean();
    return students.filter((s) => {
        const start = getEffectiveStartDate(s);
        if (!start || start > now) return false;
        const end = getInternshipEndDate(start, s.tenure || s.v2DurationType);
        return !end || end >= now;
    });
}

/** Attendance summaries for many students with one query. */
async function attendanceFor(students, domainOf = (s) => s.domain) {
    const ids = students.map((s) => s.employeeId).filter(Boolean);
    const rows = ids.length ? await Attendance.find({ employeeId: { $in: ids } }).select('employeeId dateKey status domain markedBy').lean() : [];
    const byId = new Map();
    for (const r of rows) {
        if (!byId.has(r.employeeId)) byId.set(r.employeeId, []);
        byId.get(r.employeeId).push(r);
    }
    const out = new Map();
    for (const s of students) {
        try {
            out.set(s.employeeId, getAttendanceSummary(filterByDomain(byId.get(s.employeeId) || [], domainOf(s), s), s));
        } catch (_) { /* one odd record must not stop the rest */ }
    }
    return out;
}

/** Write the key; false when it is already there (already sent, or being sent). */
async function claim(key, student, source, kind = 'reminder') {
    try {
        await AiCoordinatorLog.create({
            kind, key, source,
            employeeId: (student && student.employeeId) || '', studentId: (student && student._id) || null,
            domain: (student && student.domain) || ''
        });
        return true;
    } catch (err) {
        if (err && err.code === 11000) return false;
        throw err;
    }
}

/** A notification from the AI Coordinator: portal and phone, and email when `email`. */
async function notify(student, { title, message, email }) {
    const note = new Notification({
        title, message, type: 'info', from: ai.SENDER,
        targetType: 'student', targetEmployeeId: student.employeeId, targetDomain: student.domain || ''
    });
    if (!email) note.$locals.skipEmail = true;
    await note.save();
}

const pct = (att) => (att && att.startDate ? `${att.percentage}%` : '');

// ── Reminders ────────────────────────────────────────────────────────────

async function remindInactive(now, students, atts) {
    const since = new Date(now - 90 * DAY);
    const rows = await LoginEvent.aggregate([
        { $match: { userType: 'student', success: true, loginAt: { $gte: since } } },
        { $group: { _id: '$userId', at: { $max: '$loginAt' } } }
    ]);
    const signIns = new Map(rows.map((r) => [String(r._id), r.at]));

    let sent = 0;
    let waiting = 0;
    for (const s of students) {
        const last = latest(signIns.get(s.employeeId), s.lastActiveDate, s.createdAt);
        if (!last) continue;
        const days = Math.floor((now - last) / DAY);
        if (days < INACTIVE_FROM || days >= INACTIVE_UNTIL) continue;
        if (sent >= MAX_PER_RUN) { waiting += 1; continue; }
        if (!(await claim(`inactive:${s.employeeId}:${istDateKey(last)}`, s, 'inactive'))) continue;
        const att = atts.get(s.employeeId);
        await notify(s, {
            title: `You haven't signed in for ${days} days`,
            message: 'Your TEN internship is still running. Sign in to mark today\'s attendance and keep your tasks moving: ' +
                'the Letter of Completion needs 75% attendance' + (pct(att) ? `, and yours is ${pct(att)} so far` : '') + '. ' +
                'Stuck on something? Message your coordinator in Messages.',
            email: !s.emailOptOut
        });
        sent += 1;
    }
    if (waiting) console.log(`[ai-coordinator] ${waiting} sign-in reminder(s) left for tomorrow (at most ${MAX_PER_RUN} a day).`);
    return sent;
}

async function remindWeek(now, students) {
    let sent = 0;
    const week = istDateKey(now);
    for (const s of students) {
        if (sent >= MAX_PER_RUN) break;
        const p = await ai.progressOf(s).catch(() => null);
        if (!p || !p.week || !p.current.length) continue;
        if (!(await claim(`week:${s.employeeId}:${p.week}:${week}`, s, 'week'))) continue;
        const titles = p.current.slice(0, 4).map((t) => `"${t.title}"`).join(', ');
        await notify(s, {
            title: `Week ${p.week}: ${p.current.length} task${p.current.length === 1 ? '' : 's'} left`,
            message: `Still to do in Week ${p.week}: ${titles}${p.current.length > 4 ? ' and more' : ''}. ` +
                `Finish them and pass each task's quiz to open Week ${p.week + 1}. Questions? Message your coordinator in Messages.`,
            email: false
        });
        sent += 1;
    }
    return sent;
}

async function weeklyProgress(now, students, atts) {
    let sent = 0;
    const since = new Date(now - 7 * DAY);
    for (const s of students) {
        if (sent >= MAX_PER_RUN) break;
        const p = await ai.progressOf(s).catch(() => null);
        const att = atts.get(s.employeeId);
        if (!(p && p.total) && !pct(att)) continue;
        if (!(await claim(`weekly:${s.employeeId}:${istDateKey(now)}`, s, 'weekly'))) continue;
        const done = p ? p.approvedAt.filter((d) => d >= since).length : 0;
        const parts = [];
        if (p && p.total) parts.push(`${done} task${done === 1 ? '' : 's'} approved this week (${p.approved} of ${p.total} so far)`);
        if (pct(att)) parts.push(`attendance ${pct(att)} (75% is needed)`);
        const next = p && p.current[0] ? ` Next: "${p.current[0].title}".` : '';
        await notify(s, {
            title: 'Your week at TEN',
            message: parts.join(', ').replace(/^./, (c) => c.toUpperCase()) + '.' + next,
            email: false
        });
        sent += 1;
    }
    return sent;
}

/** One pass of the student reminders; the day of the week decides which. */
async function runReminders(now = new Date()) {
    if (!ai.enabled() || mongoose.connection.readyState !== 1) return { skipped: true };
    const students = await runningStudents(now);
    const atts = await attendanceFor(students);
    const weekday = new Date(now.getTime() + 5.5 * 3600 * 1000).getUTCDay();   // in India
    const out = { inactive: await remindInactive(now, students, atts) };
    if (weekday === 4) out.week = await remindWeek(now, students);
    if (weekday === 0) out.weekly = await weeklyProgress(now, students, atts);
    console.log('[ai-coordinator] reminders sent:', JSON.stringify(out));
    return out;
}

// ── The coordinators' summary ────────────────────────────────────────────

/** What a domain's coordinators see in the AI Assistant tab, and in the morning email. */
async function buildSummary(domain, now = new Date()) {
    const rx = domainRx(domain);
    const Submission = mongoose.model('Submission');
    const [waiting, students] = await Promise.all([
        Submission.find({ domain: rx, status: 'Pending', reviewedOnce: { $ne: true } })
            .sort({ submittedAt: 1 }).select('employeeId task submittedAt aiCheck').limit(500).lean(),
        runningStudents(now, { domain: rx })
    ]);

    const names = new Map(students.map((s) => [s.employeeId, nameOf(s)]));
    const missing = Array.from(new Set(waiting.map((w) => w.employeeId)))
        .filter((id) => id && !names.has(id));
    if (missing.length) {
        for (const s of await Student.find({ employeeId: { $in: missing } }).select('employeeId name firstName lastName').lean()) {
            names.set(s.employeeId, nameOf(s));
        }
    }
    const who = (id) => names.get(id) || id;

    const atts = await attendanceFor(students, () => domain);
    const lowAttendance = students
        .map((s) => ({ s, a: atts.get(s.employeeId) }))
        .filter(({ a }) => a && a.startDate && a.workingDaysElapsed >= 3 && a.percentage < 75)
        .sort((x, y) => x.a.percentage - y.a.percentage)
        .map(({ s, a }) => ({
            employeeId: s.employeeId, name: nameOf(s), percentage: a.percentage,
            stillNeedsByEnd: a.stillNeedsByEnd, canStillQualify: a.canStillQualify
        }));

    return {
        success: true,
        domain,
        generatedAt: now,
        enabled: ai.enabled(),
        pending: {
            count: waiting.length,
            oldestDays: waiting.length ? Math.max(0, Math.floor((now - new Date(waiting[0].submittedAt)) / DAY)) : 0,
            items: waiting.slice(0, 15).map((w) => {
                const c = w.aiCheck;
                return {
                    id: String(w._id), employeeId: w.employeeId, name: who(w.employeeId),
                    task: String(w.task || 'a task').slice(0, 120),
                    days: Math.max(0, Math.floor((now - new Date(w.submittedAt)) / DAY)),
                    ai: !c ? 'none' : (c.problems && c.problems.length ? 'problems' : 'ready'),
                    problems: (c && c.problems) || []
                };
            })
        },
        lowAttendance
    };
}

function summaryEmail(summary, coordinatorName) {
    const e = mailer.escapeHtml;
    const list = (items) => (items.length ? '<ul style="margin:6px 0 0 18px;padding:0;">' + items.map((i) => `<li style="margin:4px 0;">${i}</li>`).join('') + '</ul>' : '');
    const P = summary.pending;
    const A = summary.lowAttendance;
    const section = (title, line, items) => `<p style="margin:18px 0 0;"><b style="color:#f5c542;">${title}</b><br>${line}</p>${list(items)}`;
    const bodyHtml =
        section('Waiting for your review', P.count ? `${P.count} submission(s), the oldest for ${P.oldestDays} day(s).` : 'Nothing is waiting.',
            P.items.slice(0, 10).map((i) => `${e(i.name)} (${e(i.employeeId)}): ${e(i.task)} — ` +
                (i.ai === 'ready' ? 'AI pre-check: looks ready' : i.ai === 'problems' ? 'AI pre-check: ' + e(i.problems.join(' ')) : 'not checked yet'))) +
        section('Attendance under 75%', A.length ? `${A.length} student(s).` : 'Everyone is at 75% or more.',
            A.slice(0, 15).map((a) => `${e(a.name)} (${e(a.employeeId)}): ${a.percentage}%` +
                (a.canStillQualify ? `, needs ${a.stillNeedsByEnd} more day(s) by the end` : ', cannot reach 75% by the end date')));
    return mailer.renderEmail({
        heading: `${summary.domain}: today's summary`,
        name: coordinatorName,
        bodyHtml: '<p style="margin:0;">Here is what the AI Coordinator saw in your domain. It reviews the clear cases itself, labelled as its own; the rest waits for you.</p>' + bodyHtml,
        cta: { label: 'Open the AI Assistant', url: mailer.PORTAL_URL + '/coordinator-dashboard.html' },
        footerWhy: `You coordinate the ${summary.domain} domain on the TEN portal.`
    });
}

/** The morning summary for every domain with a coordinator. */
async function runSummaries(now = new Date()) {
    if (!ai.enabled() || mongoose.connection.readyState !== 1) return { skipped: true };
    const today = istDateKey(now);
    let domains = 0;
    let emails = 0;
    const transporter = mailer.mailerReady() ? mailer.createEmailTransporter() : null;
    for (const domain of await ai.domainsWithCoordinators()) {
        try {
            const summary = await buildSummary(domain, now);
            const nothing = !summary.pending.count && !summary.lowAttendance.length;
            if (nothing) continue;
            if (!(await claim(`summary:${domain.toLowerCase()}:${today}`, { domain }, 'summary', 'summary'))) continue;
            domains += 1;

            await new Notification({
                title: "Today's AI summary",
                message: `${summary.pending.count} submission(s) waiting, ${summary.lowAttendance.length} under 75% attendance. ` +
                    'Open the AI Assistant tab for the details.',
                type: 'info',
                from: ai.NAME, targetType: 'coordinator-domain', targetDomain: domain
            }).save();

            if (!transporter) continue;
            for (const c of await ai.coordinatorsFor(domain)) {
                if (!mailer.isSendableAddress(c.email)) continue;
                const subject = `${domain}: today's summary from the AI Coordinator`;
                try {
                    await transporter.sendMail({ from: mailer.EMAIL_FROM, to: c.email, subject, html: summaryEmail(summary, c.name) });
                    emails += 1;
                    await MailHistory.create({ recipientEmail: c.email, recipientName: c.name, subject, mailType: 'ai_coordinator_summary' }).catch(() => {});
                } catch (err) {
                    console.error('[ai-coordinator] summary email failed:', err.message);
                    await MailHistory.create({ recipientEmail: c.email, recipientName: c.name, subject, mailType: 'ai_coordinator_summary', status: 'failed', errorMessage: err.message }).catch(() => {});
                }
            }
        } catch (err) {
            console.error(`[ai-coordinator] summary for ${domain} failed:`, err.message);
        }
    }
    console.log(`[ai-coordinator] summaries: ${domains} domain(s), ${emails} email(s).`);
    return { domains, emails };
}

// ── Reviewing the waiting submissions ────────────────────────────────────

/**
 * Gemini's free daily quota is shared with the exam papers and the chat, so the
 * backlog stops asking it once this many pre-checks (of any kind) were made
 * today and carries on tomorrow. A student's own hand-in is checked whatever
 * the count, and a submission whose check is already fresh needs no new one.
 */
const PRECHECKS_PER_DAY = 150;
/** A pre-check this recent is reused rather than made again. */
const FRESH_MS = 24 * 3600 * 1000;
/** Submissions handed in within this many days are reviewed by the AI; older
 *  ones only get their pre-check, and wait for a person. */
const REVIEW_DAYS = 60;
const PAUSE_MS = 10 * 1000;
/** After a GitHub repository, without GITHUB_TOKEN: GitHub allows 60 lookups an
 *  hour and a repository takes 2; this uses 48 and leaves 12 for new hand-ins. */
const GITHUB_PAUSE_MS = 150 * 1000;
/** Waiting for a coordinator (a fresh object each time: mongoose may cast a filter in place). */
const pending = (extra) => Object.assign({ status: 'Pending', reviewedOnce: { $ne: true } }, extra);
const istMidnight = (d) => new Date(istDateKey(d) + 'T00:00:00+05:30');
/** AI_COORDINATOR_REVIEW=off keeps the pre-checks and leaves every decision to a person. */
const reviewOn = () => !/^(off|false|0|no)$/i.test(String(process.env.AI_COORDINATOR_REVIEW || 'on').trim());

let reviewFn = null;
let certFns = null;
/**
 * server.js hands over reviewSubmission(), the path the coordinator's Approve
 * button takes, and for certificates its criteria and approveForCertificate(),
 * the path the Students tab's "Approve for Certificate" takes.
 */
function attach({ review, certificate } = {}) {
    if (review) reviewFn = review;
    if (certificate) certFns = certificate;
}

/**
 * What the AI does with a pre-checked submission. Approved only when every
 * check passed, the AI read it, and it neither said the work is something
 * else nor asked for changes; asked for changes when a check failed or the AI
 * asked for them; otherwise nothing, and it waits for a person (the report
 * names it). The AI wrote its feedback for its own decision, so the status
 * follows that decision: an approval never carries "change this and submit it
 * again".
 *
 *   { status: 'Approved' | 'Rejected', feedback } or { wait: why }
 */
function decide(check) {
    if (!check) return { wait: 'no pre-check yet' };
    if (check.problems && check.problems.length) return { status: 'Rejected', feedback: check.draft };
    if (check.by !== 'ai') return { wait: 'the AI did not read it' };
    // Nobody saw the files, so neither "approve" nor "add your code" is a decision.
    if (check.repo && check.repo.filesUnread) return { wait: "the repository's files could not be read" };
    const opened = (check.link && check.link.verdict === 'opens') || (check.repo && check.repo.public && !check.repo.empty);
    if (!opened) return { wait: 'the link could not be checked' };
    if (check.match === 'no' || check.decision === 'changes') return { status: 'Rejected', feedback: check.draft };
    return { status: 'Approved', feedback: check.draft };
}

/**
 * The AI's decision on one waiting submission, through the review path.
 *   { status }   decided (and logged)
 *   { already }  a person decided it in the meantime
 *   { wait }     not a clear case: it waits for a person
 */
async function applyDecision(sub, check) {
    const d = decide(check);
    if (!d.status) return { wait: d.wait };
    const r = await reviewFn({ id: sub._id, status: d.status, feedback: d.feedback, from: ai.SENDER, reviewedBy: 'ai' });
    if (!(r && r.success)) {
        if (r && r.alreadyReviewed) return { already: true };
        console.error('[ai-coordinator] review not saved:', (r && r.message) || 'no answer');
        return { wait: 'the review was not saved' };
    }
    await AiCoordinatorLog.create({
        kind: 'review', employeeId: sub.employeeId || '', domain: sub.domain || '',
        question: String(sub.task || '').slice(0, 200), reply: String(d.feedback || '').slice(0, 1000),
        source: d.status === 'Approved' ? 'approve' : 'changes', reason: check.match || ''
    }).catch((err) => console.error('[ai-coordinator] log failed:', err.message));
    return { status: d.status };
}

/**
 * A student's hand-in or resubmission, right after its pre-check: decided now
 * when it is a clear case, so the status follows what the student fixed.
 * Returns true when a decision was made.
 */
async function reviewOne(id, check) {
    if (!reviewOn() || !reviewFn || !ai.enabled() || mongoose.connection.readyState !== 1) return false;
    const sub = await mongoose.model('Submission').findOne(pending({ _id: id })).select('employeeId domain task aiCheck').lean();
    if (!sub) return false;
    const out = await applyDecision(sub, check || sub.aiCheck);
    return !!out.status;
}

let backlogRunning = false;
/**
 * Every waiting submission, oldest first: a pre-check where there is none fresh,
 * then, within REVIEW_DAYS, the AI's decision through the coordinator's own
 * review path. Nothing is dropped: what it cannot decide stays waiting, is
 * tried again next run, and is counted in the report.
 */
async function reviewBacklog() {
    if (backlogRunning || !ai.enabled() || mongoose.connection.readyState !== 1) return null;
    backlogRunning = true;
    const Submission = mongoose.model('Submission');
    const out = { waiting: 0, checked: 0, approved: 0, changes: 0, waited: 0, older: 0, left: 0, stopped: '' };
    const cutoff = new Date(Date.now() - REVIEW_DAYS * DAY);
    try {
        // The list is taken once: a new hand-in is checked when it arrives.
        const subs = await Submission.find(pending()).sort({ submittedAt: 1 }).select('_id image submittedAt aiCheck employeeId domain task').lean();
        const recent = subs.filter((x) => new Date(x.submittedAt || 0) >= cutoff);
        const older = subs.filter((x) => new Date(x.submittedAt || 0) < cutoff && !x.aiCheck);
        out.waiting = subs.length;
        out.older = subs.length - recent.length;
        if (!subs.length) return out;
        console.log(`[ai-coordinator] backlog: ${subs.length} waiting submission(s), ${recent.length} within ${REVIEW_DAYS} days.`);

        let budgetOut = false;
        // A check without `engine` was written before the feedback became the
        // review itself, and may promise a follow-up: it is made again.
        const fresh = (c) => c && c.at && (Date.now() - new Date(c.at)) < FRESH_MS && c.by === 'ai' && !!c.engine;
        for (const sub of recent.concat(older)) {
            if (!ai.enabled() || mongoose.connection.readyState !== 1) { out.stopped = ai.enabled() ? 'the database went away' : 'switched off'; break; }
            let check = fresh(sub.aiCheck) ? sub.aiCheck : null;
            let network = false;
            if (!check) {
                if (!budgetOut) {
                    const today = await AiCoordinatorLog.countDocuments({ kind: 'precheck', createdAt: { $gte: istMidnight(new Date()) } });
                    budgetOut = today >= PRECHECKS_PER_DAY;
                    if (budgetOut) out.stopped = `today's ${PRECHECKS_PER_DAY} pre-checks are made; the rest go tomorrow`;
                }
                if (budgetOut) { out.waited += 1; continue; }
                // A screenshot counts as missing only where one was attached and
                // is gone: a Task Journey hand-in never has one. The decision
                // below tells the student what to fix, so the check stays quiet.
                check = await precheck.run(sub._id, { screenshotExpected: !!sub.image, notify: false });
                network = true;
                if (check) out.checked += 1;
            }
            const inScope = new Date(sub.submittedAt || 0) >= cutoff;
            if (check && inScope && reviewOn() && reviewFn) {
                const r = await applyDecision(sub, check);
                if (r.status) out[r.status === 'Approved' ? 'approved' : 'changes'] += 1;
                else if (!r.already) out.waited += 1;
            } else if (check && inScope) {
                out.waited += 1;
            }
            const done = out.checked + out.approved + out.changes;
            if (network && done % 10 === 0) console.log(`[ai-coordinator] backlog: ${out.checked} pre-checked, ${out.approved} approved, ${out.changes} asked for changes so far.`);
            if (network) await module.exports._internal.wait(check && check.repo && !process.env.GITHUB_TOKEN ? GITHUB_PAUSE_MS : PAUSE_MS);
        }
    } finally {
        backlogRunning = false;
    }
    out.left = await Submission.countDocuments(pending());
    console.log(`[ai-coordinator] backlog: ${out.checked} pre-checked, ${out.approved} approved, ${out.changes} asked for changes, ` +
        `${out.left} still waiting` + (out.stopped ? ` (${out.stopped}).` : '.'));
    return out;
}

// ── Certificates: the coordinator's approval, for those who finished ─────

/**
 * Students whose internship ended within the last REVIEW_DAYS days and who
 * meet both criteria (attendance 75% or more, five or more approved tasks)
 * are approved for certificate consideration the way the coordinator's
 * Students tab does it, and so reach HR's queue. The rest wait for a person:
 * not yet eligible, or returned by HR once already.
 */
async function approveCertificates(now = new Date()) {
    if (!reviewOn() || !certFns || !ai.enabled() || mongoose.connection.readyState !== 1) return null;
    const out = { finished: 0, approved: 0, notYet: 0, lowAttendance: 0, fewTasks: 0, returned: 0 };
    const students = await Student.find({ certificateApprovedByCoordinator: { $ne: true } });
    for (const s of students) {
        const start = getEffectiveStartDate(s);
        const end = start ? getInternshipEndDate(start, s.tenure || s.v2DurationType) : null;
        if (!end || end > now || now - end > REVIEW_DAYS * DAY) continue;
        out.finished += 1;
        if (s.hrRejected) { out.returned += 1; continue; }
        const c = await certFns.criteria(s);
        if (!c.ok) {
            out.notYet += 1;
            if (c.attendance < 75) out.lowAttendance += 1;
            if (c.approvedTasks < 5) out.fewTasks += 1;
            continue;
        }
        const facts = `attendance ${c.attendance}%, ${c.approvedTasks} tasks approved, internship ended ${istDateKey(end)}`;
        await certFns.approve(s, {
            approver: ai.NAME, from: ai.SENDER,
            remarks: `Approved by the AI Coordinator: ${facts}.`,
            message: `You're approved for certificate consideration: ${facts}. HR gives the final approval.`
        });
        out.approved += 1;
        await AiCoordinatorLog.create({
            kind: 'certificate', employeeId: s.employeeId || '', domain: s.domain || '',
            question: facts, reply: 'sent to HR', source: 'approve'
        }).catch((err) => console.error('[ai-coordinator] log failed:', err.message));
    }
    console.log(`[ai-coordinator] certificates: ${out.finished} finished in the last ${REVIEW_DAYS} days, ${out.approved} approved and sent to HR, ` +
        `${out.notYet} not yet eligible (${out.lowAttendance} under 75% attendance, ${out.fewTasks} under 5 approved tasks), ${out.returned} returned by HR.`);
    return out;
}

/** The scheduled run: the submissions, then the certificates, then one report of both. */
async function dailyRun() {
    const b = await reviewBacklog();
    const c = await approveCertificates().catch((err) => { console.error('[ai-coordinator] certificates:', err.message); return null; });
    const did = (b && (b.checked || b.approved || b.changes)) || (c && c.approved);
    if (!did) return { backlog: b, certificates: c };
    await sendReport(new Date(), `daily run: ${b ? b.approved : 0} approved, ${b ? b.changes : 0} asked for changes, ` +
        `${b ? b.left : 0} still waiting; ${c ? c.approved : 0} sent to HR for certificates`)
        .catch((err) => console.error('[ai-coordinator] report failed:', err.message));
    return { backlog: b, certificates: c };
}

// ── The report: proof of what the AI did ─────────────────────────────────

/** Everything the AI Coordinator did in the 24 hours to `now`, from its own log. */
async function buildReport(now = new Date()) {
    const since = new Date(now - DAY);
    const cutoff = new Date(now - REVIEW_DAYS * DAY);
    const Submission = mongoose.model('Submission');
    const [logs, waiting, unchecked, older, mails] = await Promise.all([
        AiCoordinatorLog.find({ createdAt: { $gt: since, $lte: now } }).sort({ createdAt: -1 }).limit(5000).lean(),
        Submission.countDocuments(pending()),
        Submission.countDocuments(pending({ aiCheck: null })),
        Submission.countDocuments(pending({ submittedAt: { $lt: cutoff } })),
        MailHistory.find({ mailType: 'ai_coordinator_summary', sentAt: { $gt: since, $lte: now } }).select('status').lean()
    ]);
    const of = (kind) => logs.filter((l) => l.kind === kind);
    return {
        since, now, waiting, unchecked, older,
        prechecks: of('precheck'), reviews: of('review'),
        certificates: of('certificate'), meetings: of('meeting'), reminders: of('reminder'), summaries: of('summary'),
        summaryEmails: { sent: mails.filter((m) => m.status !== 'failed').length, failed: mails.filter((m) => m.status === 'failed').length }
    };
}

function reportText(r) {
    const n = (rows, source) => rows.filter((x) => x.source === source).length;
    const clip = (s, len) => { const t = String(s || '').replace(/\s+/g, ' ').trim(); return t.length > len ? t.slice(0, len - 1) + '…' : t; };
    const at = (d) => new Date(d).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    const unsure = Math.max(0, r.waiting - r.unchecked - r.older);
    return [
        `What the AI Coordinator did from ${at(r.since)} to ${at(r.now)} (IST).`,
        '',
        `1. Reviewed submissions: ${r.reviews.length} (${n(r.reviews, 'approve')} approved, ${n(r.reviews, 'changes')} asked for changes), after ${r.prechecks.length} pre-check(s).`,
        ...r.reviews.slice(0, 5).map((p) => `   ${at(p.createdAt)}, ${p.employeeId}: "${clip(p.question, 70)}" -> ` +
            (p.source === 'approve' ? 'approved' : 'asked for changes') + (p.reply ? `: ${clip(p.reply, 120)}` : '')),
        `   Still waiting for a coordinator: ${r.waiting}. Of these, ${r.unchecked} have no pre-check yet, ` +
            `${unsure} could not be checked automatically or the AI did not read them (a person should look), ` +
            `and ${r.older} are older than ${REVIEW_DAYS} days (left for a person).`,
        `2. Approved for certificates and sent to HR: ${r.certificates.length}.`,
        ...r.certificates.slice(0, 5).map((c) => `   ${at(c.createdAt)}, ${c.employeeId}: ${clip(c.question, 100)}`),
        `3. Reminders: ${r.reminders.length} (${n(r.reminders, 'inactive')} sign-in, ${n(r.reminders, 'week')} unfinished week, ${n(r.reminders, 'weekly')} weekly progress).`,
        `4. Coordinator summaries: ${r.summaries.length} domain(s); ${r.summaryEmails.sent} email(s) sent, ${r.summaryEmails.failed} failed.`,
        `5. Interview Room: ${n(r.meetings, 'report')} interview(s) finished, ${n(r.meetings, 'interview')} question turn(s).`,
        ...r.meetings.filter((m) => m.source === 'report').slice(0, 5).map((m) => `   ${at(m.createdAt)}, ${m.employeeId}: ${clip(m.question, 40)}, ${clip(m.reply, 160)}`),
        '',
        'The AI approves a submission only when every check passed and it read the work and found it the task; it asks for changes when a check failed, or when the work is not the task or is missing a main part of it.',
        'It approves a student for a certificate only when the internship has ended with 75% attendance and five approved tasks; HR still decides.',
        'Anything it could not check waits for a person. Each decision is labelled as the AI\'s in both dashboards.'
    ].join('\n');
}

/** The report, to the team inbox (SUPPORT_COPY_TO) from the help desk's mailbox, as scripts/server/mail-team.js does. */
async function sendReport(now = new Date(), title = '') {
    if (!ai.enabled() || mongoose.connection.readyState !== 1) return null;
    const r = await buildReport(now);
    const text = reportText(r);
    console.log(`[ai-coordinator] report: ` +
        `${r.reviews.length} reviewed, ${r.prechecks.length} pre-checked, ${r.certificates.length} sent to HR, ${r.reminders.length} reminder(s), ${r.summaries.length} summary(ies).`);
    const gmail = require('./supportDesk/gmail');
    const to = String(process.env.SUPPORT_COPY_TO || '').trim();
    if (!to || !gmail.configured()) {
        console.log('[ai-coordinator] no team inbox (SUPPORT_COPY_TO and the help desk mailbox), so the report is only in this log.');
        return { sent: false, text };
    }
    const MailComposer = require('nodemailer/lib/mail-composer');
    const from = (await gmail.profile()).emailAddress;
    const subject = '[ai-coordinator] ' + (title ||
        `daily report: ${r.reviews.length} reviewed, ${r.certificates.length} sent to HR, ${r.reminders.length} reminders`);
    const raw = await new MailComposer({ from, to, subject, text }).compile().build();
    await gmail.send(raw.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''));
    return { sent: true, text };
}

let started = false;
/** Called once from server.js on the cron worker, after attach(). */
function start() {
    if (started) return;
    started = true;
    const tz = { timezone: 'Asia/Kolkata' };
    const backlog = () => dailyRun().catch((err) => console.error('[ai-coordinator] backlog:', err.message));
    // Twice a day: at night, when nobody is sitting an exam on the same Gemini
    // quota, and before the coordinators' morning summary.
    cron.schedule('5 2 * * *', backlog, tz);
    cron.schedule('35 8 * * *', backlog, tz);
    cron.schedule('5 9 * * *', () => runSummaries().catch((err) => console.error('[ai-coordinator] summaries:', err.message)), tz);
    cron.schedule('5 10 * * *', () => runReminders().catch((err) => console.error('[ai-coordinator] reminders:', err.message)), tz);
    cron.schedule('20 10 * * *', () => sendReport().catch((err) => console.error('[ai-coordinator] report:', err.message)), tz);
    // And a minute after each start, so a deploy picks up whatever is waiting.
    const soon = () => setTimeout(backlog, 60 * 1000).unref();
    if (mongoose.connection.readyState === 1) soon(); else mongoose.connection.once('connected', soon);
    console.log('[ai-coordinator] submission review and certificate approvals 02:05, 08:35 and on start' + (reviewOn() ? '' : ' (pre-checks only, AI_COORDINATOR_REVIEW=off)') +
        ', summaries 09:05, reminders 10:05, report 10:20 (IST) scheduled.');
}

module.exports = {
    attach, start, runReminders, runSummaries, buildSummary, runningStudents, reviewBacklog, reviewOne, approveCertificates, dailyRun, buildReport, sendReport,
    _internal: { summaryEmail, claim, latest, reportText, decide, wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)), PRECHECKS_PER_DAY, REVIEW_DAYS }
};
