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
 *                     waiting, who was handed over, who is under 75%, what the
 *                     AI answered. By email to coordinators with an address,
 *                     and in the dashboard's AI Assistant tab, always current.
 *   08:35 every day,  the pre-check for every waiting submission that never
 *   and on boot       had one (those handed in before the AI Coordinator went
 *                     live, or whose check could not start), oldest first.
 *   10:20 every day   a report to the team inbox (SUPPORT_COPY_TO) of what the
 *                     AI did in the last 24 hours; also when a backlog run ends.
 *
 * Every reminder and summary has a key, written before it is sent, so a second
 * run or a restart never sends it twice. Nothing here costs money: the
 * pre-check uses Gemini's free tier, email goes through the portal's own SMTP
 * account, and the report through the help desk's mailbox.
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
        title, message, type: 'info', from: ai.NAME,
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
                'Stuck on something? Ask the AI Coordinator in Messages, at any hour.',
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
                `Finish them and pass each task's quiz to open Week ${p.week + 1}. Questions? Ask the AI Coordinator in Messages.`,
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
    const since = new Date(now - DAY);
    const Submission = mongoose.model('Submission');
    const [waiting, logs, students] = await Promise.all([
        Submission.find({ domain: rx, status: 'Pending', reviewedOnce: { $ne: true } })
            .sort({ submittedAt: 1 }).select('employeeId task submittedAt aiCheck').limit(500).lean(),
        AiCoordinatorLog.find({ domain: rx, kind: { $in: ['answer', 'handover'] }, createdAt: { $gte: since } })
            .sort({ createdAt: -1 }).limit(300).lean(),
        runningStudents(now, { domain: rx })
    ]);

    const names = new Map(students.map((s) => [s.employeeId, nameOf(s)]));
    const missing = Array.from(new Set(waiting.map((w) => w.employeeId).concat(logs.map((l) => l.employeeId))))
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

    const handovers = logs.filter((l) => l.kind === 'handover').map((l) => ({
        at: l.createdAt, employeeId: l.employeeId, name: who(l.employeeId),
        question: String(l.question || '').slice(0, 300), about: ai.HANDOVER_LABEL[l.source] || 'something only a person can answer'
    }));
    const count = (src) => logs.filter((l) => l.kind === 'answer' && l.source === src).length;

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
        handovers,
        lowAttendance,
        answered: {
            total: logs.length, saved: count('saved'), ai: count('ai'), handover: handovers.length,
            recent: logs.slice(0, 8).map((l) => ({
                at: l.createdAt, employeeId: l.employeeId, question: String(l.question || '').slice(0, 160),
                source: l.kind === 'handover' ? 'handover' : l.source
            }))
        }
    };
}

function summaryEmail(summary, coordinatorName) {
    const e = mailer.escapeHtml;
    const list = (items) => (items.length ? '<ul style="margin:6px 0 0 18px;padding:0;">' + items.map((i) => `<li style="margin:4px 0;">${i}</li>`).join('') + '</ul>' : '');
    const P = summary.pending;
    const H = summary.handovers;
    const A = summary.lowAttendance;
    const Q = summary.answered;
    const section = (title, line, items) => `<p style="margin:18px 0 0;"><b style="color:#f5c542;">${title}</b><br>${line}</p>${list(items)}`;
    const bodyHtml =
        section('Waiting for your review', P.count ? `${P.count} submission(s), the oldest for ${P.oldestDays} day(s).` : 'Nothing is waiting.',
            P.items.slice(0, 10).map((i) => `${e(i.name)} (${e(i.employeeId)}): ${e(i.task)} — ` +
                (i.ai === 'ready' ? 'AI pre-check: looks ready' : i.ai === 'problems' ? 'AI pre-check: ' + e(i.problems.join(' ')) : 'not checked yet'))) +
        section('Handed over to you by the AI (last 24 hours)', H.length ? `${H.length} student(s) need a person.` : 'None.',
            H.slice(0, 10).map((h) => `<b>${e(h.name)}</b> (${e(h.employeeId)}), about ${e(h.about)}: "${e(h.question)}"`)) +
        section('Attendance under 75%', A.length ? `${A.length} student(s).` : 'Everyone is at 75% or more.',
            A.slice(0, 15).map((a) => `${e(a.name)} (${e(a.employeeId)}): ${a.percentage}%` +
                (a.canStillQualify ? `, needs ${a.stillNeedsByEnd} more day(s) by the end` : ', cannot reach 75% by the end date'))) +
        section('What the AI answered (last 24 hours)',
            `${Q.total} question(s): ${Q.saved} from saved answers, ${Q.ai} written by the AI, ${Q.handover} handed over.`, []);
    return mailer.renderEmail({
        heading: `${summary.domain}: today's summary`,
        name: coordinatorName,
        bodyHtml: '<p style="margin:0;">Here is what the AI Coordinator saw in your domain. It approves nothing: every decision is yours.</p>' + bodyHtml,
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
            const nothing = !summary.pending.count && !summary.handovers.length && !summary.lowAttendance.length && !summary.answered.total;
            if (nothing) continue;
            if (!(await claim(`summary:${domain.toLowerCase()}:${today}`, { domain }, 'summary', 'summary'))) continue;
            domains += 1;

            await new Notification({
                title: "Today's AI summary",
                message: `${summary.pending.count} submission(s) waiting, ${summary.handovers.length} student(s) handed over to you, ` +
                    `${summary.lowAttendance.length} under 75% attendance, ${summary.answered.total} question(s) answered by the AI. ` +
                    'Open the AI Assistant tab for the details.',
                type: summary.handovers.length ? 'warning' : 'info',
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

// ── The pre-check backlog ────────────────────────────────────────────────

/**
 * Gemini's free daily quota is shared with the exam papers and the chat, so the
 * backlog stops once this many pre-checks (of any kind) were made today and
 * carries on tomorrow. A student's own hand-in is checked whatever the count.
 */
const PRECHECKS_PER_DAY = 150;
const PAUSE_MS = 10 * 1000;
/** After a GitHub repository, without GITHUB_TOKEN: GitHub allows 60 lookups an
 *  hour and a repository takes 2, so this uses 24 and leaves the rest for new hand-ins. */
const GITHUB_PAUSE_MS = 5 * 60 * 1000;
/** Waiting for a coordinator (a fresh object each time: mongoose may cast a filter in place). */
const pending = (extra) => Object.assign({ status: 'Pending', reviewedOnce: { $ne: true } }, extra);
const istMidnight = (d) => new Date(istDateKey(d) + 'T00:00:00+05:30');

let backlogRunning = false;
/** Pre-check, oldest first, every waiting submission that never had one. */
async function precheckBacklog() {
    if (backlogRunning || !ai.enabled() || mongoose.connection.readyState !== 1) return null;
    backlogRunning = true;
    const Submission = mongoose.model('Submission');
    const out = { waiting: 0, checked: 0, left: 0, stopped: '' };
    try {
        // The list is taken once: a new hand-in is checked when it arrives.
        const subs = await Submission.find(pending({ aiCheck: null }))
            .sort({ submittedAt: 1 }).select('_id image').lean();
        out.waiting = subs.length;
        if (!subs.length) return out;
        console.log(`[ai-coordinator] backlog: ${subs.length} waiting submission(s) without a pre-check.`);
        for (let i = 0; i < subs.length; i++) {
            if (!ai.enabled() || mongoose.connection.readyState !== 1) { out.stopped = ai.enabled() ? 'the database went away' : 'switched off'; break; }
            const today = await AiCoordinatorLog.countDocuments({ kind: 'precheck', createdAt: { $gte: istMidnight(new Date()) } });
            if (today >= PRECHECKS_PER_DAY) { out.stopped = `today's ${PRECHECKS_PER_DAY} pre-checks are made; the rest go tomorrow`; break; }
            // A screenshot counts as missing only where one was attached and is
            // gone: a Task Journey hand-in never has one.
            const check = await precheck.run(subs[i]._id, { screenshotExpected: !!subs[i].image });
            if (check) out.checked += 1;
            if (check && out.checked % 10 === 0) console.log(`[ai-coordinator] backlog: ${out.checked} of ${subs.length} pre-checked.`);
            if (i < subs.length - 1) {
                await module.exports._internal.wait(check && check.repo && !process.env.GITHUB_TOKEN ? GITHUB_PAUSE_MS : PAUSE_MS);
            }
        }
    } finally {
        backlogRunning = false;
    }
    out.left = await Submission.countDocuments(pending({ aiCheck: null }));
    console.log(`[ai-coordinator] backlog: ${out.checked} pre-checked, ${out.left} still without one` +
        (out.stopped ? ` (${out.stopped}).` : '.'));
    if (out.checked) {
        await sendReport(new Date(), `pre-check backlog: ${out.checked} checked, ${out.left} ` +
            (out.stopped && out.left ? 'left for tomorrow' : 'still without one'))
            .catch((err) => console.error('[ai-coordinator] report failed:', err.message));
    }
    return out;
}

// ── The report: proof of what the AI did ─────────────────────────────────

/** Everything the AI Coordinator did in the 24 hours to `now`, from its own log. */
async function buildReport(now = new Date()) {
    const since = new Date(now - DAY);
    const Submission = mongoose.model('Submission');
    const [logs, waiting, unchecked, mails] = await Promise.all([
        AiCoordinatorLog.find({ createdAt: { $gt: since, $lte: now } }).sort({ createdAt: -1 }).limit(5000).lean(),
        Submission.countDocuments(pending()),
        Submission.countDocuments(pending({ aiCheck: null })),
        MailHistory.find({ mailType: 'ai_coordinator_summary', sentAt: { $gt: since, $lte: now } }).select('status').lean()
    ]);
    const of = (kind) => logs.filter((l) => l.kind === kind);
    return {
        since, now, waiting, unchecked,
        answers: of('answer'), handovers: of('handover'), prechecks: of('precheck'),
        reminders: of('reminder'), summaries: of('summary'),
        summaryEmails: { sent: mails.filter((m) => m.status !== 'failed').length, failed: mails.filter((m) => m.status === 'failed').length }
    };
}

function reportText(r) {
    const n = (rows, source) => rows.filter((x) => x.source === source).length;
    const clip = (s, len) => { const t = String(s || '').replace(/\s+/g, ' ').trim(); return t.length > len ? t.slice(0, len - 1) + '…' : t; };
    const at = (d) => new Date(d).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    const byReason = Object.entries(r.handovers.reduce((m, h) => { m[h.source] = (m[h.source] || 0) + 1; return m; }, {}))
        .map(([k, v]) => `${ai.HANDOVER_LABEL[k] || k}: ${v}`).join('; ');
    return [
        `What the AI Coordinator did from ${at(r.since)} to ${at(r.now)} (IST).`,
        '',
        `1. Answered students in Messages: ${r.answers.length} (${n(r.answers, 'saved')} from saved answers, ${n(r.answers, 'ai')} by Gemini).`,
        ...r.answers.slice(0, 3).map((a) => `   ${at(a.createdAt)}, ${a.employeeId}: "${clip(ai.scrub(a.question), 90)}" -> "${clip(a.reply, 140)}"`),
        `2. Handed over to a coordinator: ${r.handovers.length}${byReason ? ` (${byReason})` : ''}.`,
        `3. Pre-checked submissions: ${r.prechecks.length} (${n(r.prechecks, 'approve')} look ready, ${n(r.prechecks, 'changes')} need changes).`,
        `   Waiting for a coordinator now: ${r.waiting}, of which ${r.unchecked} still have no pre-check.`,
        ...r.prechecks.slice(0, 3).map((p) => `   ${at(p.createdAt)}, ${p.employeeId}: "${clip(p.question, 70)}" -> ` +
            (p.source === 'approve' ? 'looks ready' : 'needs changes') + (p.reply ? `: ${clip(p.reply, 120)}` : '')),
        `4. Reminders: ${r.reminders.length} (${n(r.reminders, 'inactive')} sign-in, ${n(r.reminders, 'week')} unfinished week, ${n(r.reminders, 'weekly')} weekly progress).`,
        `5. Coordinator summaries: ${r.summaries.length} domain(s); ${r.summaryEmails.sent} email(s) sent, ${r.summaryEmails.failed} failed.`,
        '',
        'The AI approves nothing: a coordinator approves, with the AI\'s draft already in the feedback box.',
        'The details are in the coordinator dashboard, under AI Assistant.'
    ].join('\n');
}

/** The report, to the team inbox (SUPPORT_COPY_TO) from the help desk's mailbox, as scripts/server/mail-team.js does. */
async function sendReport(now = new Date(), title = '') {
    if (!ai.enabled() || mongoose.connection.readyState !== 1) return null;
    const r = await buildReport(now);
    const text = reportText(r);
    console.log(`[ai-coordinator] report: ${r.answers.length} answered, ${r.handovers.length} handed over, ` +
        `${r.prechecks.length} pre-checked, ${r.reminders.length} reminder(s), ${r.summaries.length} summary(ies).`);
    const gmail = require('./supportDesk/gmail');
    const to = String(process.env.SUPPORT_COPY_TO || '').trim();
    if (!to || !gmail.configured()) {
        console.log('[ai-coordinator] no team inbox (SUPPORT_COPY_TO and the help desk mailbox), so the report is only in this log.');
        return { sent: false, text };
    }
    const MailComposer = require('nodemailer/lib/mail-composer');
    const from = (await gmail.profile()).emailAddress;
    const subject = '[ai-coordinator] ' + (title ||
        `daily report: ${r.answers.length} answered, ${r.prechecks.length} pre-checked, ${r.reminders.length} reminders`);
    const raw = await new MailComposer({ from, to, subject, text }).compile().build();
    await gmail.send(raw.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''));
    return { sent: true, text };
}

let started = false;
/** Called once from server.js on the cron worker. */
function start() {
    if (started) return;
    started = true;
    const tz = { timezone: 'Asia/Kolkata' };
    const backlog = () => precheckBacklog().catch((err) => console.error('[ai-coordinator] backlog:', err.message));
    cron.schedule('35 8 * * *', backlog, tz);
    cron.schedule('5 9 * * *', () => runSummaries().catch((err) => console.error('[ai-coordinator] summaries:', err.message)), tz);
    cron.schedule('5 10 * * *', () => runReminders().catch((err) => console.error('[ai-coordinator] reminders:', err.message)), tz);
    cron.schedule('20 10 * * *', () => sendReport().catch((err) => console.error('[ai-coordinator] report:', err.message)), tz);
    // And a minute after each start, so a deploy picks up whatever is waiting.
    const soon = () => setTimeout(backlog, 60 * 1000).unref();
    if (mongoose.connection.readyState === 1) soon(); else mongoose.connection.once('connected', soon);
    console.log('[ai-coordinator] backlog pre-check 08:35 and on start, summaries 09:05, reminders 10:05, report 10:20 (IST) scheduled.');
}

module.exports = {
    start, runReminders, runSummaries, buildSummary, runningStudents, precheckBacklog, buildReport, sendReport,
    _internal: { summaryEmail, claim, latest, reportText, wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)), PRECHECKS_PER_DAY }
};
