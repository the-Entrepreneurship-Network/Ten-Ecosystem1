'use strict';

/**
 * The Career Studio's daily nudges, run once a day from server.js:
 *
 *   followUps() — an application sent 4 or 10 days ago (the days the agent's
 *                 drafted follow-ups are for) and not yet followed up.
 *   jobAlerts() — openings the collector stored since the student last
 *                 looked that fit what they hunted for (models/JobAlert.js).
 *
 * Both arrive as a portal notification and on the phone
 * (services/notificationPush.js). Neither is emailed — the Monday mail already
 * uses most of the month's marketing allowance — except the weekly digest a
 * student switched on.
 */

const DAY = 86400000;
const FIT = 60;                                          // "moderate" or better, as the cards band it
const RECENT_DAYS = 7;
const keyOf = (j) => `${j.title}|${j.company}`.toLowerCase().trim();

function notify(employeeId, title, message, { email = false } = {}) {
    const Notification = require('../../models/Notification');
    const note = new Notification({ title: title.slice(0, 140), message, type: 'info', from: 'Job Portal', targetType: 'student', targetEmployeeId: employeeId });
    if (!email) note.$locals.skipEmail = true;
    return note.save();
}

const list = (items) => (items.length <= 2 ? items.join(' and ') : `${items.slice(0, 2).join(', ')} and ${items.length - 2} more`);

async function followUps(now = new Date()) {
    const JobTrack = require('../../models/JobTrack');
    const rows = await JobTrack.find({
        status: { $in: ['applied', 'emailed'] }, employeeId: { $nin: ['', null] }, appliedAt: { $lte: new Date(now - 4 * DAY) },
    }).lean();
    let sent = 0;
    for (const r of rows) {
        const days = (r.followUps || []).map((f) => f.afterDays).filter(Boolean);
        const due = (days.length ? days : [4, 10]).filter((d) => now - new Date(r.appliedAt) >= d * DAY
            && !(r.followUpsSent || []).includes(d) && !(r.nudged || []).includes(d));
        if (!due.length) continue;
        const d = Math.max(...due);
        await notify(r.employeeId, `Day ${d}: follow up with ${r.company || 'the employer'}`,
            `It is ${d} days since you applied for ${r.role || 'the role'}${r.company ? ` at ${r.company}` : ''}. `
            + 'Your follow-up is written and waiting in the Job Portal tracker: open it, send it, and mark it sent.');
        await JobTrack.updateOne({ _id: r._id }, { $addToSet: { nudged: { $each: due } } });
        sent += 1;
    }
    return sent;
}

async function jobAlerts(now = new Date()) {
    const JobAlert = require('../../models/JobAlert');
    const jobStore = require('./jobStore');
    const { fitness } = require('./jobFitness');
    const { rank } = require('../../routes/v2/jobAgent');
    const out = { alerted: 0, emailed: 0 };
    const alerts = await JobAlert.find({ alerts: true, employeeId: { $nin: ['', null] } }).lean();
    for (const a of alerts) {
        const profile = { ...a.profile, skills: (a.profile && a.profile.skills) || [] };
        if (!profile.role) continue;
        const fits = rank(await jobStore.find(profile, 300), profile)
            .filter((j) => j.posted && now - new Date(j.posted) <= RECENT_DAYS * DAY)
            .filter((j) => fitness(profile, j).percent >= FIT);
        const seen = new Set(a.seen || []);
        const fresh = fits.filter((j) => !seen.has(keyOf(j)));
        if (fresh.length) {
            await notify(a.employeeId, `${fresh.length} new ${fresh.length === 1 ? 'job fits' : 'jobs fit'} your resume`,
                `${list(fresh.slice(0, 5).map((j) => `${j.title}${j.company ? ` at ${j.company}` : ''}`))}. Open the Job Portal to see ${fresh.length === 1 ? 'it' : 'them'}.`);
            out.alerted += 1;
        }
        const set = { lastAlertAt: now };
        const weekly = a.weeklyEmail && fits.length && (!a.lastEmailAt || now - new Date(a.lastEmailAt) >= 7 * DAY);
        if (weekly) {
            await notify(a.employeeId, `Your weekly job digest: ${fits.length} ${fits.length === 1 ? 'opening fits' : 'openings fit'}`,
                fits.slice(0, 8).map((j) => `${j.title}${j.company ? ` — ${j.company}` : ''}: ${j.directUrl || j.url}`).join('\n')
                + '\n\nYou asked for this weekly email in the Job Portal; switch it off there.', { email: true });
            set.lastEmailAt = now;
            out.emailed += 1;
        }
        await JobAlert.updateOne({ _id: a._id }, { $set: set, $push: { seen: { $each: fresh.map(keyOf), $slice: -500 } } });
    }
    return out;
}

async function runDaily(now = new Date()) {
    const nudged = await followUps(now).catch((err) => { console.error('[career-alerts] follow-ups:', err.message); return 0; });
    const alerts = await jobAlerts(now).catch((err) => { console.error('[career-alerts] job alerts:', err.message); return { alerted: 0, emailed: 0 }; });
    console.log(`[career-alerts] ${nudged} follow-up reminder(s), ${alerts.alerted} job alert(s), ${alerts.emailed} weekly digest(s).`);
    return { nudged, ...alerts };
}

module.exports = { runDaily, followUps, jobAlerts, keyOf };
