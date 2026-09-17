"use strict";

const cron = require("node-cron");
const { buildDailyReport, formatWhatsApp } = require("./attendanceReport");
const sender = require("./whatsappSender");
const loginEvents = require("./loginEvents");
const attendanceSettings = require("./attendanceSettings");
const { dateKeyFor, shiftDateKey, isDateKey, reportTimeZone, humanDate } = require("../../utils/reportClock");

const ACTION_SENT = "ATTENDANCE_REPORT_SENT";
const ACTION_SKIPPED = "ATTENDANCE_REPORT_SKIPPED";

// The report goes to ATTENDANCE_REPORT_TO and nowhere else. The number the
// sender is registered on (WHATSAPP_PHONE_NUMBER_ID) and whatever test
// recipient the n8n flow uses are deliberately not consulted here, so
// changing where the report lands is one variable and cannot leak into the
// rest of the WhatsApp setup.
function recipients() {
    // Split on separators only: a number written "+91 83178 73609" keeps its spaces.
    return String(process.env.ATTENDANCE_REPORT_TO || attendanceSettings.fromDb("reportTo") || "")
        .split(/[,;\n]+/)
        .map(sender.normalizeNumber)
        .filter(Boolean);
}

function config() {
    const retention = parseInt(process.env.ATTENDANCE_LOGIN_RETENTION_DAYS || "90", 10);
    return {
        enabled: String(process.env.ATTENDANCE_AGENT_ENABLED || "true").toLowerCase() !== "false",
        cron: String(process.env.ATTENDANCE_REPORT_CRON || attendanceSettings.cronFromTime(attendanceSettings.fromDb("reportTime")) || "5 23 * * *").trim(),
        day: String(process.env.ATTENDANCE_REPORT_DAY || "today").toLowerCase() === "yesterday" ? "yesterday" : "today",
        tz: reportTimeZone(),
        retentionDays: Math.max(7, Number.isFinite(retention) ? retention : 90),
        recipients: recipients(),
        transport: sender.resolveTransport(),
    };
}

function defaultDateKey(c = config()) {
    const today = dateKeyFor(new Date(), c.tz);
    return c.day === "yesterday" ? shiftDateKey(today, -1) : today;
}

async function auditLog(entry) {
    try {
        const AuditLog = require("../../models/AuditLog");
        await AuditLog.create(entry);
    } catch (err) {
        console.warn("[ATTENDANCE-AGENT] audit not written:", err.message);
    }
}

async function alreadySent(dateKey) {
    try {
        const AuditLog = require("../../models/AuditLog");
        const hit = await AuditLog.findOne({
            actionType: ACTION_SENT, "newState.dateKey": dateKey, "newState.ok": true,
        }).lean();
        return Boolean(hit);
    } catch (_) {
        return false;
    }
}

// Build the day's report and deliver it. Once per day unless forced; a dry
// run (no transport configured) never counts as delivered.
async function runDaily({ dateKey, force = false, trigger = "cron", by = "AUTO_SYSTEM" } = {}) {
    const c = config();
    const key = isDateKey(dateKey) ? dateKey : defaultDateKey(c);

    if (!force && await alreadySent(key)) {
        return { ok: true, skipped: true, reason: "already sent", dateKey: key };
    }

    const report = await buildDailyReport(key, { tz: c.tz });
    const text = formatWhatsApp(report);

    if (!c.recipients.length) {
        console.warn("[ATTENDANCE-AGENT] ATTENDANCE_REPORT_TO is not set; report built but not sent.");
        await auditLog({
            actionType: ACTION_SKIPPED, performedBy: by,
            description: `Report for ${key} not sent: ATTENDANCE_REPORT_TO is not set`,
            newState: { dateKey: key, trigger, reason: "no recipient" },
        });
        return { ok: false, skipped: true, reason: "no recipient", dateKey: key, text, report };
    }

    // For a template send only two parameters travel: the date and one line.
    const t = report.totals;
    const f = report.form;
    const templateParams = [
        humanDate(key),
        f
            ? `${f.uniqueRespondents} filled the form${f.totalResponses !== f.uniqueRespondents ? ` (${f.totalResponses} responses)` : ""}`
            : `${t.uniqueUsers} signed in, ${t.logins} sign-ins, ${t.failedAttempts} failed`,
    ];

    const results = [];
    for (const to of c.recipients) {
        const r = await sender.send({
            to, text, templateParams,
            payload: { kind: "attendance_daily", dateKey: key, trigger, summary: t },
        });
        results.push({ to: sender.mask(to), ...r });
    }

    const dryRun = results.some((r) => r.dryRun);
    const delivered = results.filter((r) => r.ok && !r.dryRun).length;
    const ok = delivered === results.length;
    const failedTo = results.filter((r) => !r.ok).map((r) => `${r.to}: ${r.error}`);

    await auditLog({
        actionType: ok ? ACTION_SENT : ACTION_SKIPPED,
        performedBy: by,
        description: ok
            ? `Sign-in report for ${key} sent to ${results.length} recipient(s)`
            : dryRun ? `Sign-in report for ${key} built (dry run, no transport)`
                     : `Sign-in report for ${key} failed: ${failedTo.join("; ")}`,
        newState: { dateKey: key, ok, dryRun, trigger, results, totals: t },
    });

    return { ok, dryRun, delivered, dateKey: key, results, text, report };
}

let jobs = [];
let listening = false;

function stop() {
    jobs.forEach((j) => { try { j.stop(); } catch (_) {} });
    jobs = [];
}

function initAttendanceAgent() {
    // Settings saved from the portal move the schedule and the recipient
    // without a restart: load them now, keep them fresh, and re-plan the jobs
    // whenever they change.
    if (!listening) {
        listening = true;
        attendanceSettings.onChange(() => { if (jobs.length) initAttendanceAgent(); });
        attendanceSettings.load().catch(() => {});
        attendanceSettings.startRefresh();
    }
    const c = config();
    if (!c.enabled) {
        console.log("[ATTENDANCE-AGENT] disabled (ATTENDANCE_AGENT_ENABLED=false)");
        return [];
    }
    if (!cron.validate(c.cron)) {
        console.error(`[ATTENDANCE-AGENT] invalid ATTENDANCE_REPORT_CRON "${c.cron}"; not scheduled`);
        return [];
    }
    stop();
    jobs.push(cron.schedule(c.cron, () => {
        runDaily({ trigger: "cron" }).catch((err) => console.error("[ATTENDANCE-AGENT] run failed:", err.message));
    }, { timezone: c.tz }));
    jobs.push(cron.schedule("15 3 * * *", () => {
        loginEvents.purgeOlderThan(c.retentionDays)
            .then((n) => { if (n) console.log(`[ATTENDANCE-AGENT] purged ${n} login events older than ${c.retentionDays} days`); })
            .catch(() => {});
    }, { timezone: c.tz }));

    const where = c.recipients.length
        ? c.recipients.map(sender.mask).join(", ")
        : "NO RECIPIENT (set ATTENDANCE_REPORT_TO)";
    console.log(`[ATTENDANCE-AGENT] daily sign-in report at "${c.cron}" ${c.tz} -> ${where} via ${c.transport}`);
    return jobs;
}

module.exports = {
    runDaily, initAttendanceAgent, stop, config, recipients, defaultDateKey,
    ACTION_SENT, ACTION_SKIPPED,
};
