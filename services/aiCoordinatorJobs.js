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
 *
 * Every reminder and summary has a key, written before it is sent, so a second
 * run or a restart never sends it twice. Nothing here costs money: no AI is
 * used, and email goes through the portal's own SMTP account.
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

let started = false;
/** Called once from server.js on the cron worker. */
function start() {
    if (started) return;
    started = true;
    const tz = { timezone: 'Asia/Kolkata' };
    cron.schedule('5 9 * * *', () => runSummaries().catch((err) => console.error('[ai-coordinator] summaries:', err.message)), tz);
    cron.schedule('5 10 * * *', () => runReminders().catch((err) => console.error('[ai-coordinator] reminders:', err.message)), tz);
    console.log('[ai-coordinator] reminders 10:05 and coordinator summaries 09:05 (IST) scheduled.');
}

module.exports = { start, runReminders, runSummaries, buildSummary, runningStudents, _internal: { summaryEmail, claim, latest } };
