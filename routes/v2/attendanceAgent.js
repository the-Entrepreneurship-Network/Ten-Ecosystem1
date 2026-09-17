"use strict";

const router = require("express").Router();
const agent = require("../../services/v2/attendanceAgent");
const { buildDailyReport, formatWhatsApp } = require("../../services/v2/attendanceReport");
const loginEvents = require("../../services/v2/loginEvents");
const sender = require("../../services/v2/whatsappSender");
const formResponses = require("../../services/v2/formResponses");
const { isDateKey } = require("../../utils/reportClock");

// Who is asking is answered by the session and nothing else, through the
// same middleware every other portal route uses: HR or admin for the agent's
// controls, HR or coordinator for the tables, and the signed-in student for
// their own days. A header or query string never names anyone.
const { requireHR, requireStaff, sessionEmployeeId } = require("../../middleware/sessionAuth");
const attendanceSettings = require("../../services/v2/attendanceSettings");

function studentOf(req) {
    const s = (req.session && req.session.student) || {};
    return { employeeId: String(sessionEmployeeId(req) || "").trim(), email: String(s.email || "").trim().toLowerCase() };
}

function dayOf(req) {
    const d = (req.query && req.query.date) || (req.body && req.body.date);
    return isDateKey(d) ? d : agent.defaultDateKey();
}

// Inclusive day range for the tables; the current month to date by default.
function rangeOf(req) {
    const today = agent.defaultDateKey();
    const q = req.query || {};
    const to = isDateKey(q.to) ? q.to : today;
    const from = isDateKey(q.from) ? q.from : `${to.slice(0, 7)}-01`;
    return from <= to ? { from, to } : { from: to, to: from };
}

// The portal's own domain roster, so the suggestion list is complete on a day
// with no responses yet.
function domainList() {
    try {
        const cfg = require("../../config/domains");
        if (Array.isArray(cfg.DOMAIN_NAMES)) return cfg.DOMAIN_NAMES.filter(Boolean);
        const list = cfg.DOMAINS || cfg.domains || cfg;
        if (Array.isArray(list)) return list.map((d) => (typeof d === "string" ? d : d && (d.name || d.label || d.title))).filter(Boolean);
    } catch (_) { /* no domain config in this build */ }
    return [];
}

function csvEscape(v) {
    const s = String(v === undefined || v === null ? "" : v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function sendCsv(res, name, rows) {
    const body = rows.map((r) => r.map(csvEscape).join(",")).join("\r\n") + "\r\n";
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${name}"`);
    res.send("﻿" + body);
}

function statusOf(count, required) {
    if (!count) return "";
    return count >= required ? "complete" : "partial";
}

async function myAttendance(req) {
    const who = studentOf(req);
    if (!who.employeeId && !who.email) {
        const err = new Error("Please sign in to continue.");
        err.status = 401;
        throw err;
    }
    const { from, to } = rangeOf(req);
    const all = await formResponses.byPerson({ from, to });
    const me = formResponses.personFor(all.people, who);
    const days = all.dates.map((date) => {
        const count = me ? (me.days[date] || 0) : 0;
        return { date, count, complete: count >= all.required, status: statusOf(count, all.required) };
    });
    return {
        employeeId: (me && me.employeeId) || who.employeeId,
        name: (me && me.name) || "",
        domain: (me && me.domain) || "",
        from, to, required: all.required,
        days,
        totals: {
            daysMarked: me ? me.daysMarked : 0,
            daysComplete: me ? me.daysComplete : 0,
            responses: me ? me.responses : 0,
        },
    };
}

async function allAttendance(req) {
    const { from, to } = rangeOf(req);
    const q = req.query || {};
    const filters = { domain: String(q.domain || ""), q: String(q.q || "") };
    const all = await formResponses.byPerson({ from, to, fresh: q.fresh === "true" });
    const people = all.people.filter((p) => formResponses.matchesPerson(p, filters));
    // The configured domains first, then any spelling the form itself has
    // produced, so the suggestion list never misses a domain that has data.
    const domains = domainList();
    const seen = new Set(domains.map((d) => d.toLowerCase()));
    for (const p of all.people) {
        if (p.domain && !seen.has(p.domain.toLowerCase())) { domains.push(p.domain); seen.add(p.domain.toLowerCase()); }
    }
    return {
        from, to, required: all.required, filters,
        dates: all.dates,
        domains,
        people,
        total: people.length,
        totalPeople: all.people.length,
        responses: all.responses,
    };
}

// What the agent will do, with the recipient masked so HR can confirm it is
// the right number without the number itself being on screen.
router.get("/config", requireHR, (req, res) => {
    const c = agent.config();
    res.json({
        success: true,
        config: {
            enabled: c.enabled, cron: c.cron, day: c.day, tz: c.tz,
            transport: c.transport, retentionDays: c.retentionDays,
            recipients: c.recipients.map(sender.mask),
            recipientCount: c.recipients.length,
            nextDateKey: agent.defaultDateKey(c),
            formConfigured: formResponses.isConfigured(),
        },
    });
});

// The day's form submissions, as the report will list them.
router.get("/form", requireStaff, async (req, res) => {
    try {
        if (!formResponses.isConfigured()) {
            return res.status(400).json({ success: false, message: "ATTENDANCE_SHEET_URL is not set (the form's linked responses sheet)" });
        }
        const day = await formResponses.responsesForDay(dayOf(req));
        return res.json({ success: true, ...day });
    } catch (err) {
        return res.status(502).json({ success: false, message: err.message });
    }
});

// A student's own days: which dates they filled the form and how many times.
router.get("/my", async (req, res) => {
    try {
        if (!formResponses.isConfigured()) {
            return res.status(400).json({ success: false, message: "Attendance form is not configured" });
        }
        return res.json({ success: true, ...(await myAttendance(req)) });
    } catch (err) {
        return res.status(err.status || 502).json({ success: false, message: err.message });
    }
});

router.get("/my.csv", async (req, res) => {
    try {
        const me = await myAttendance(req);
        const rows = [["Date", "Responses", "Required", "Status"]];
        me.days.forEach((d) => rows.push([d.date, d.count, me.required, d.status || "absent"]));
        sendCsv(res, `attendance-${me.employeeId || "me"}-${me.from}-to-${me.to}.csv`, rows);
    } catch (err) {
        res.status(err.status || 502).json({ success: false, message: err.message });
    }
});

// Every student: one row each, one column per day, narrowed by day range and
// domain (exact via `domain`, or as typed via `q`).
router.get("/all", requireStaff, async (req, res) => {
    try {
        if (!formResponses.isConfigured()) {
            return res.status(400).json({ success: false, message: "Attendance form is not configured" });
        }
        return res.json({ success: true, ...(await allAttendance(req)) });
    } catch (err) {
        return res.status(err.status || 502).json({ success: false, message: err.message });
    }
});

router.get("/all.csv", requireStaff, async (req, res) => {
    try {
        const all = await allAttendance(req);
        const rows = [["Name", "Employee ID", "Domain", ...all.dates, "Days marked", "Days complete", "Responses"]];
        all.people.forEach((p) => rows.push([
            p.name, p.employeeId, p.domain,
            ...all.dates.map((d) => p.days[d] || 0),
            p.daysMarked, p.daysComplete, p.responses,
        ]));
        sendCsv(res, `attendance-${all.from}-to-${all.to}.csv`, rows);
    } catch (err) {
        res.status(err.status || 502).json({ success: false, message: err.message });
    }
});

// Can the sheet be read at all, and which columns will the report use.
router.get("/form/check", requireStaff, async (req, res) => {
    try {
        const sheet = await formResponses.fetchSheet();
        const tsIdx = Math.max(0, sheet.header.findIndex((h) => /^timestamp$/i.test(h)));
        res.json({
            success: true,
            url: sheet.url,
            header: sheet.header,
            rowCount: sheet.rows.length,
            columns: formResponses.pickColumns(sheet.header, formResponses.settings().columns).map((c) => c.label),
            dateFormat: formResponses.detectDateFormat(sheet.rows, tsIdx),
        });
    } catch (err) {
        res.status(502).json({ success: false, message: err.message });
    }
});

// What the agent runs with and where each value comes from. Secrets never
// leave the server: the token shows only whether it is set and its last four.
function settingsView() {
    const { values, source } = attendanceSettings.effective();
    const c = agent.config();
    return {
        values: { ...values, whatsappToken: attendanceSettings.mask(values.whatsappToken) },
        source,
        tokenSet: Boolean(values.whatsappToken),
        recipients: String(values.reportTo || "").split(",").filter(Boolean).map(sender.mask),
        cron: c.cron,
        reportTime: attendanceSettings.timeFromCron(c.cron) || c.cron,
        tz: c.tz,
        transport: c.transport,
        formConfigured: formResponses.isConfigured(),
    };
}

router.get("/settings", requireHR, async (req, res) => {
    try {
        await attendanceSettings.load();
        res.json({ success: true, settings: settingsView() });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

router.put("/settings", requireHR, async (req, res) => {
    try {
        const by = (req.hrUser && (req.hrUser.username || req.hrUser.email)) || "HR";
        const patch = { ...(req.body || {}) };
        // The token field comes back masked or blank when it was not retyped;
        // neither is a new token. null clears it on purpose.
        if (patch.whatsappToken !== undefined && patch.whatsappToken !== null) {
            const t = String(patch.whatsappToken).trim();
            if (t === "" || /^\*+\S{0,4}$/.test(t)) delete patch.whatsappToken;
        }
        await attendanceSettings.save(patch, by);
        formResponses.clearCache();
        try {
            const AuditLog = require("../../models/AuditLog");
            await AuditLog.create({
                actionType: "ATTENDANCE_SETTINGS_UPDATED", performedBy: by,
                description: `Attendance agent settings changed: ${Object.keys(patch).join(", ")}`,
                newState: { fields: Object.keys(patch) },
            });
        } catch (_) { /* the audit line is best effort */ }
        res.json({ success: true, settings: settingsView() });
    } catch (err) {
        res.status(err.status || 500).json({ success: false, message: err.message, errors: err.errors || [] });
    }
});

// One short message to the configured number, so the whole pipeline can be
// proved in the afternoon rather than waited for at night.
router.post("/settings/test-send", requireHR, async (req, res) => {
    try {
        const c = agent.config();
        if (!c.recipients.length) return res.status(400).json({ success: false, message: "No report number is set" });
        const when = attendanceSettings.timeFromCron(c.cron) || c.cron;
        const text = `TEN attendance agent: test message. The daily attendance report will arrive here at ${when} (${c.tz}).`;
        const results = [];
        for (const to of c.recipients) {
            results.push({ to: sender.mask(to), ...(await sender.send({ to, text, templateParams: ["Test", "attendance agent connected"] })) });
        }
        const ok = results.every((r) => r.ok && !r.dryRun);
        return res.status(ok ? 200 : 502).json({ success: ok, results });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

router.get("/logins", requireHR, async (req, res) => {
    try {
        const dateKey = dayOf(req);
        const f = {};
        if (req.query.role) f.userType = String(req.query.role);
        if (req.query.domain) f.domain = String(req.query.domain);
        if (req.query.success === "true") f.success = true;
        if (req.query.success === "false") f.success = false;
        const logins = await loginEvents.listByDay(dateKey, f);
        res.json({ success: true, dateKey, count: logins.length, logins });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

router.get("/report", requireHR, async (req, res) => {
    try {
        const report = await buildDailyReport(dayOf(req));
        res.json({ success: true, report });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// Exactly the text WhatsApp will receive.
router.get("/report/text", requireHR, async (req, res) => {
    try {
        const report = await buildDailyReport(dayOf(req));
        res.type("text/plain").send(formatWhatsApp(report));
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

router.post("/report/send", requireHR, async (req, res) => {
    try {
        const body = req.body || {};
        const force = body.force === true || body.force === "true";
        const by = (req.session && req.session.hrUser && req.session.hrUser.username)
            || (req.session && req.session.adminUser && req.session.adminUser.username)
            || "HR";
        const out = await agent.runDaily({ dateKey: dayOf(req), force, trigger: "manual", by });
        const { report, ...rest } = out;
        res.status(out.ok || out.skipped ? 200 : 502).json({ success: Boolean(out.ok), ...rest });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

module.exports = router;
