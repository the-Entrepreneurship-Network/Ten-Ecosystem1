"use strict";

const mongoose = require("mongoose");
const loginEvents = require("./loginEvents");
const sources = require("./attendanceSources");
const formResponses = require("./formResponses");
const { clockFor, reportTimeZone, humanDate } = require("../../utils/reportClock");

const ROLE_ORDER = ["student", "coordinator", "hr", "admin", "founder", "mentor", "investor", "contractor", "ecosystem", "unknown"];
const ROLE_LABEL = {
    student: "Students", coordinator: "Coordinators", hr: "HR", admin: "Admin",
    founder: "Founders", mentor: "Mentors", investor: "Investors", contractor: "Contractors",
    ecosystem: "Ecosystem users", unknown: "Other",
};

const EMPTY_PORTAL = {
    totals: { logins: 0, uniqueUsers: 0, byRole: {}, failedAttempts: 0, studentsSelfMarked: 0 },
    byRole: {},
    anomalies: { markedWithoutLogin: [], loginWithoutMark: [] },
    failures: { count: 0, top: [] },
};

// Who signed in to the portals on a day, when, and how that compares with
// what students marked about themselves.
async function portalSection(dateKey, tz) {
    const events = await loginEvents.listByDay(dateKey);
    const ok = events.filter((e) => e.success !== false);
    const failed = events.filter((e) => e.success === false);

    // One row per person: first and last sign-in of the day, how many times.
    const people = new Map();
    for (const e of ok) {
        const key = `${e.userType}|${e.userId || e.email || e.label}`;
        const at = new Date(e.loginAt);
        const row = people.get(key) || {
            userType: e.userType,
            userId: e.userId || "",
            label: e.label || e.email || e.userId || "?",
            email: e.email || "",
            domain: e.domain || "",
            firstAt: at, lastAt: at, count: 0,
            portals: new Set(),
            ip: e.ip || "",
        };
        row.count += 1;
        if (at < row.firstAt) { row.firstAt = at; row.ip = e.ip || row.ip; }
        if (at > row.lastAt) row.lastAt = at;
        if (e.portal) row.portals.add(e.portal);
        people.set(key, row);
    }
    const rows = [...people.values()]
        .map((r) => ({
            ...r,
            portals: [...r.portals],
            firstAt: r.firstAt.toISOString(),
            lastAt: r.lastAt.toISOString(),
            firstClock: clockFor(r.firstAt, tz),
            lastClock: clockFor(r.lastAt, tz),
        }))
        .sort((a, b) => (a.firstAt < b.firstAt ? -1 : a.firstAt > b.firstAt ? 1 : 0));

    const byRole = {};
    for (const r of rows) (byRole[r.userType] = byRole[r.userType] || []).push(r);

    // Students: what they marked against what the server saw.
    const marks = await sources.selfMarksFor(dateKey);
    const markedIds = new Set(marks.map((m) => m.employeeId).filter(Boolean));
    const students = byRole.student || [];
    const loggedIds = new Set(students.map((r) => r.userId).filter(Boolean));

    const markedWithoutLoginIds = [...markedIds].filter((id) => !loggedIds.has(id));
    const named = await sources.studentsByEmployeeIds(markedWithoutLoginIds);
    const nameOf = new Map(named.map((s) => [s.employeeId, {
        label: `${s.firstName || ""} ${s.lastName || ""}`.trim() || s.employeeId,
        domain: (s.domains && s.domains[0]) || s.domain || "",
    }]));
    const markedWithoutLogin = markedWithoutLoginIds.map((id) => ({
        employeeId: id, ...(nameOf.get(id) || { label: id, domain: "" }),
    }));
    const loginWithoutMark = students
        .filter((r) => r.userId && !markedIds.has(r.userId))
        .map((r) => ({ employeeId: r.userId, label: r.label, domain: r.domain, firstClock: r.firstClock }));

    // Failed attempts, grouped by the account being tried.
    const failCounts = new Map();
    for (const e of failed) {
        const who = e.userId || e.email || "?";
        failCounts.set(who, (failCounts.get(who) || 0) + 1);
    }
    const failTop = [...failCounts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([who, count]) => ({ who, count }));

    return {
        totals: {
            logins: ok.length,
            uniqueUsers: rows.length,
            byRole: Object.fromEntries(ROLE_ORDER.filter((r) => byRole[r]).map((r) => [r, byRole[r].length])),
            failedAttempts: failed.length,
            studentsSelfMarked: markedIds.size,
        },
        byRole,
        anomalies: { markedWithoutLogin, loginWithoutMark },
        failures: { count: failed.length, top: failTop },
    };
}

function includePortalByDefault() {
    return String(process.env.ATTENDANCE_INCLUDE_PORTAL_LOGINS || "false").toLowerCase() === "true";
}

// The day's attendance: the Google Form first, because that is what
// attendance means here, and the portal sign-ins alongside when asked for or
// when there is no form to read.
async function buildDailyReport(dateKey, opts = {}) {
    const tz = opts.tz || reportTimeZone();
    const includePortal = opts.includePortal !== undefined ? Boolean(opts.includePortal) : includePortalByDefault();
    const formConfigured = formResponses.isConfigured();

    let form = null;
    let formError = "";
    if (formConfigured) {
        try { form = await formResponses.responsesForDay(dateKey); }
        catch (err) { formError = err.message; }
    }

    let portal = null;
    let portalError = "";
    if (mongoose.connection.readyState === 1) {
        try { portal = await portalSection(dateKey, tz); }
        catch (err) { portalError = err.message; }
    } else {
        portalError = "database not connected";
    }
    const p = portal || EMPTY_PORTAL;

    return {
        dateKey, tz,
        generatedAt: new Date().toISOString(),
        formConfigured, includePortal,
        form, formError,
        totals: {
            formResponses: form ? form.totalResponses : 0,
            formRespondents: form ? form.uniqueRespondents : 0,
            ...p.totals,
        },
        byRole: p.byRole,
        anomalies: p.anomalies,
        failures: p.failures,
        portalError,
    };
}

function pushRows(L, rows, maxRows, render) {
    rows.slice(0, maxRows).forEach((r) => L.push(render(r)));
    if (rows.length > maxRows) L.push(`+${rows.length - maxRows} more`);
}

// The WhatsApp body. Bold via *asterisks*, one line per person, time first,
// capped so a busy day still fits one message (WhatsApp stops at 4096).
function formatWhatsApp(report, opts = {}) {
    const maxRows = opts.maxRows || 25;
    const maxChars = opts.maxChars || 3900;
    const L = [];

    L.push("*TEN Attendance*");
    L.push(`${humanDate(report.dateKey)} (${report.tz})`);

    if (report.formConfigured) {
        L.push("");
        L.push("*Attendance form*");
        const f = report.form;
        if (f) {
            if (!f.uniqueRespondents) {
                L.push("Nobody filled the form.");
            } else {
                L.push(`Filled: *${f.uniqueRespondents}* ${f.uniqueRespondents === 1 ? "person" : "people"}${f.totalResponses !== f.uniqueRespondents ? ` (${f.totalResponses} responses)` : ""}`);
                L.push("");
                pushRows(L, f.respondents, maxRows, (r) =>
                    `${r.firstClock}  ${r.line}${r.count > 1 ? ` x${r.count}, last ${r.lastClock}` : ""}`);
            }
        } else {
            L.push(`Form sheet could not be read: ${report.formError || "unknown error"}`);
        }
    }

    const showPortal = report.includePortal || !report.formConfigured;
    if (showPortal) {
        const t = report.totals;
        L.push("");
        L.push("*Portal sign-ins*");
        if (report.portalError && !t.uniqueUsers) {
            L.push(`Unavailable: ${report.portalError}`);
        } else if (!t.uniqueUsers) {
            L.push("No one signed in.");
        } else {
            L.push(`Signed in: *${t.uniqueUsers}* ${t.uniqueUsers === 1 ? "person" : "people"}, ${t.logins} sign-in${t.logins === 1 ? "" : "s"}`);
            const bits = Object.entries(t.byRole).map(([r, n]) => `${ROLE_LABEL[r] || r} ${n}`);
            if (bits.length) L.push(bits.join(" | "));
        }
        if (t.failedAttempts) L.push(`Failed attempts: ${t.failedAttempts}`);

        for (const role of ROLE_ORDER) {
            const rows = report.byRole[role];
            if (!rows || !rows.length) continue;
            L.push("");
            L.push(`*${ROLE_LABEL[role] || role} (${rows.length})*`);
            pushRows(L, rows, maxRows, (r) => {
                const who = r.label && r.userId && r.label !== r.userId ? `${r.label} (${r.userId})` : (r.label || r.userId);
                const dom = r.domain ? ` - ${r.domain}` : "";
                const again = r.count > 1 ? ` x${r.count}, last ${r.lastClock}` : "";
                return `${r.firstClock}  ${who}${dom}${again}`;
            });
        }

        const a = report.anomalies || EMPTY_PORTAL.anomalies;
        if (a.markedWithoutLogin.length) {
            L.push("");
            L.push(`*Marked present, no sign-in (${a.markedWithoutLogin.length})*`);
            pushRows(L, a.markedWithoutLogin, maxRows, (s) => `- ${s.label} (${s.employeeId})${s.domain ? ` - ${s.domain}` : ""}`);
        }
        if (a.loginWithoutMark.length) {
            L.push("");
            L.push(`*Signed in, attendance not marked (${a.loginWithoutMark.length})*`);
            pushRows(L, a.loginWithoutMark, maxRows, (s) => `- ${s.label} (${s.employeeId})${s.domain ? ` - ${s.domain}` : ""}`);
        }
        if (report.failures && report.failures.top && report.failures.top.length) {
            L.push("");
            L.push("*Failed sign-ins*");
            report.failures.top.forEach((f) => L.push(`- ${f.who}: ${f.count}`));
        }
    }

    let text = L.join("\n");
    if (text.length > maxChars) {
        text = text.slice(0, maxChars - 14).replace(/\n[^\n]*$/, "") + "\n...(truncated)";
    }
    return text;
}

module.exports = { buildDailyReport, formatWhatsApp, portalSection, ROLE_ORDER, ROLE_LABEL };
