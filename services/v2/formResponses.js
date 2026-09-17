"use strict";

const attendanceSettings = require("./attendanceSettings");

// The attendance Google Form. Every submission lands in the linked
// spreadsheet with "Timestamp" first and one column per question, and the
// sheet is read through its CSV export, which needs no API key once the sheet
// is shared "Anyone with the link: Viewer" (or published to the web).

function idFromUrl(url) {
    const m = String(url || "").match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
    return m ? m[1] : "";
}

function gidFromUrl(url) {
    const m = String(url || "").match(/[#&?]gid=(\d+)/);
    return m ? m[1] : "";
}

function settings() {
    // The sheet link comes from the environment when the server was configured
    // that way, else from what HR saved in the portal. A plain CSV URL saved
    // there is served as such.
    const envUrl = process.env.ATTENDANCE_SHEET_URL || "";
    const envId = process.env.ATTENDANCE_SHEET_ID || "";
    const envCsv = process.env.ATTENDANCE_SHEET_CSV_URL || "";
    const stored = (!envUrl && !envId && !envCsv) ? String(attendanceSettings.fromDb("sheetUrl") || "").trim() : "";
    const url = envUrl || stored;
    const storedIsCsv = Boolean(stored) && !idFromUrl(stored) && /^https?:\/\//i.test(stored);
    return {
        sheetId:    String(envId || idFromUrl(url)).trim(),
        gid:        String(process.env.ATTENDANCE_SHEET_GID || gidFromUrl(url) || "0").trim(),
        csvUrl:     String(envCsv || (storedIsCsv ? stored : "")).trim(),
        dateFormat: String(process.env.ATTENDANCE_SHEET_DATE_FORMAT || "auto").trim().toUpperCase(),
        columns:    String(process.env.ATTENDANCE_SHEET_COLUMNS || "").split(",").map((s) => s.trim()).filter(Boolean),
    };
}

function exportUrl(s = settings()) {
    if (s.csvUrl) return s.csvUrl;
    if (!s.sheetId) return "";
    return `https://docs.google.com/spreadsheets/d/${s.sheetId}/export?format=csv&gid=${encodeURIComponent(s.gid)}`;
}

function isConfigured() {
    return Boolean(exportUrl());
}

// Quotes, doubled quotes, newlines inside quotes, CRLF. Google's export is
// well-formed, but a free-text answer can contain anything.
function parseCsv(text) {
    const rows = [];
    let row = [];
    let cell = "";
    let quoted = false;
    const src = String(text || "");
    for (let i = 0; i < src.length; i += 1) {
        const c = src[i];
        if (quoted) {
            if (c === '"') {
                if (src[i + 1] === '"') { cell += '"'; i += 1; } else { quoted = false; }
            } else {
                cell += c;
            }
        } else if (c === '"') {
            quoted = true;
        } else if (c === ",") {
            row.push(cell); cell = "";
        } else if (c === "\n" || c === "\r") {
            if (c === "\r" && src[i + 1] === "\n") i += 1;
            row.push(cell); rows.push(row); row = []; cell = "";
        } else {
            cell += c;
        }
    }
    if (cell.length || row.length) { row.push(cell); rows.push(row); }
    return rows;
}

// Google Forms stamps a submission in the form owner's locale and timezone:
// "17/09/2026 21:05:33" for an Indian account, "9/17/2026 21:05:33" for a US
// one, and ISO when the sheet's locale says so. Which of the two slash forms
// is in use is read off the data when possible (a day above 12 settles it)
// and otherwise assumed day-first.
function parseStamp(raw, fmt = "DMY") {
    const s = String(raw || "").trim();
    let m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2}))?/);
    if (m) return { dateKey: `${m[1]}-${m[2]}-${m[3]}`, clock: `${String(m[4] || "0").padStart(2, "0")}:${m[5] || "00"}` };

    m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})(?:[ ,]+(\d{1,2}):(\d{2})(?::\d{2})?\s*([AaPp]\.?[Mm]\.?)?)?/);
    if (!m) return null;
    const a = Number(m[1]);
    const b = Number(m[2]);
    let day;
    let month;
    if (fmt === "MDY") { month = a; day = b; }
    else if (fmt === "DMY") { day = a; month = b; }
    else if (a > 12) { day = a; month = b; }
    else if (b > 12) { month = a; day = b; }
    else { day = a; month = b; }
    if (day < 1 || day > 31 || month < 1 || month > 12) return null;

    let h = m[4] ? Number(m[4]) : 0;
    const ap = m[6] || "";
    if (/p/i.test(ap) && h < 12) h += 12;
    if (/a/i.test(ap) && h === 12) h = 0;
    return {
        dateKey: `${m[3]}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
        clock: `${String(h).padStart(2, "0")}:${m[5] || "00"}`,
    };
}

function detectDateFormat(rows, tsIdx) {
    for (const r of rows) {
        const m = String(r[tsIdx] || "").match(/^(\d{1,2})[/.-](\d{1,2})[/.-]\d{4}/);
        if (!m) continue;
        if (Number(m[1]) > 12) return "DMY";
        if (Number(m[2]) > 12) return "MDY";
    }
    return "DMY";
}

const KNOWN = [
    ["employeeId", /employee|emp\.?\s*id|\bten\s*id\b|\bid\b|registration/i],
    ["name",       /\bname\b/i],
    ["domain",     /domain|department|track|team|batch/i],
    ["email",      /e-?mail/i],
    ["phone",      /phone|whatsapp|mobile|contact/i],
];

// Which columns make up a line of the report. Configured names win; otherwise
// the first column that looks like a name, an employee id and a domain, in
// display order name, id, domain.
function pickColumns(header, configured) {
    const norm = (s) => String(s || "").trim().toLowerCase();
    if (configured && configured.length) {
        return configured
            .map((want) => {
                const w = norm(want);
                let idx = header.findIndex((h) => norm(h) === w);
                if (idx < 0) idx = header.findIndex((h) => norm(h).includes(w));
                return idx >= 0 ? { idx, label: header[idx], kind: want } : null;
            })
            .filter(Boolean);
    }
    const found = {};
    header.forEach((h, idx) => {
        if (/^timestamp$/i.test(h)) return;
        for (const [kind, re] of KNOWN) {
            if (found[kind] === undefined && re.test(h)) { found[kind] = idx; return; }
        }
    });
    return ["name", "employeeId", "domain"]
        .filter((k) => found[k] !== undefined)
        .map((k) => ({ idx: found[k], label: header[found[k]], kind: k }));
}

function identityOf(header, row, cols) {
    const byKind = (k) => {
        const c = cols.find((x) => x.kind === k);
        return c ? String(row[c.idx] || "").trim().toLowerCase() : "";
    };
    const idx = header.findIndex((h) => /e-?mail/i.test(h));
    const email = idx >= 0 ? String(row[idx] || "").trim().toLowerCase() : "";
    return byKind("employeeId") || email || byKind("phone") || byKind("name") || row.join("|").toLowerCase();
}

// "Name (ID) - Domain", each part present only when answered, so a blank
// employee id does not shift the domain into the brackets.
function lineFor(fields) {
    const v = fields.map((f) => String(f.value || "").trim());
    let line = v[0] || "";
    if (v[1]) line += `${line ? " " : ""}(${v[1]})`;
    if (v[2]) line += `${line ? " - " : ""}${v[2]}`;
    return line || "(blank)";
}

// The dashboards read the sheet on every open, and a class of a few hundred
// hits the same sheet at the same time of day, so one download serves
// everyone for a couple of minutes. The nightly report and a forced refresh
// bypass it.
let cache = null;

function cacheMs() {
    const s = parseInt(process.env.ATTENDANCE_SHEET_CACHE_SECONDS || "120", 10);
    return Math.max(0, Number.isFinite(s) ? s : 120) * 1000;
}

function clearCache() { cache = null; }

async function fetchSheet({ fresh = false } = {}) {
    const s = settings();
    const url = exportUrl(s);
    if (!url) throw new Error("ATTENDANCE_SHEET_URL is not set (the form's linked responses sheet)");
    if (!fresh && cache && cache.url === url && Date.now() - cache.at < cacheMs()) {
        return { url, header: cache.header, rows: cache.rows, cached: true };
    }
    const res = await fetch(url, { redirect: "follow", headers: { Accept: "text/csv,*/*" } });
    const text = await res.text();
    if (!res.ok) throw new Error(`sheet fetch failed: HTTP ${res.status}`);
    if (/<html|<!doctype/i.test(text.slice(0, 300))) {
        throw new Error("sheet is not readable without signing in: share it as 'Anyone with the link: Viewer'");
    }
    const rows = parseCsv(text);
    const header = (rows[0] || []).map((h) => String(h).trim());
    const body = rows.slice(1).filter((r) => r.some((c) => String(c).trim()));
    cache = { url, at: Date.now(), header, rows: body };
    return { url, header, rows: body, cached: false };
}

function requiredPerDay() {
    const raw = process.env.ATTENDANCE_REQUIRED_PER_DAY || attendanceSettings.fromDb("requiredPerDay") || "2";
    const n = parseInt(raw, 10);
    return Math.max(1, Number.isFinite(n) && n > 0 ? n : 2);
}

// The form asks for the DATE and TIME the attendance is for, apart from when
// it was submitted. Where those columns exist they are the day and the clock;
// the submission timestamp stands in when they are blank or absent, so a form
// filled at ten past midnight for the day before lands on the day before.
function columnsOf(header) {
    const find = (re) => header.findIndex((h) => re.test(String(h).trim()));
    let ts = find(/^timestamp$/i);
    if (ts < 0) ts = 0;
    return { ts, date: find(/^date$/i), time: find(/^time$/i) };
}

// "21:56", "21:56:00", "9:56:00 PM" -> "21:56"
function parseClock(raw) {
    const m = String(raw || "").trim().match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*([AaPp]\.?[Mm]\.?)?$/);
    if (!m) return "";
    let h = Number(m[1]);
    const ap = m[3] || "";
    if (/p/i.test(ap) && h < 12) h += 12;
    if (/a/i.test(ap) && h === 12) h = 0;
    if (h > 23) return "";
    return `${String(h).padStart(2, "0")}:${m[2]}`;
}

function stampOf(row, idx, fmt) {
    const submitted = parseStamp(row[idx.ts], fmt);
    const chosen = idx.date >= 0 ? parseStamp(row[idx.date], fmt) : null;
    const base = chosen || submitted;
    if (!base) return null;
    const clock = (idx.time >= 0 ? parseClock(row[idx.time]) : "") || (submitted ? submitted.clock : "") || "00:00";
    return { dateKey: base.dateKey, clock };
}

function valueOf(header, row, kind, cols) {
    const c = cols.find((x) => x.kind === kind);
    if (c) return String(row[c.idx] || "").trim();
    const re = KNOWN.find(([k]) => k === kind);
    const idx = re ? header.findIndex((h) => re[1].test(h)) : -1;
    return idx >= 0 ? String(row[idx] || "").trim() : "";
}

// Everyone who submitted between two days (inclusive), with a count per day.
// One entry per person; name, id and domain are whatever they wrote most
// recently, so a corrected spelling wins.
async function byPerson({ from, to, fresh = false } = {}) {
    const { header, rows } = await fetchSheet({ fresh });
    const s = settings();
    const idx = columnsOf(header);
    const fmt = s.dateFormat === "AUTO" ? detectDateFormat(rows, idx.date >= 0 ? idx.date : idx.ts) : s.dateFormat;
    const cols = pickColumns(header, s.columns);
    const required = requiredPerDay();

    const people = new Map();
    const dates = new Set();
    let responses = 0;
    for (const r of rows) {
        const st = stampOf(r, idx, fmt);
        if (!st) continue;
        if (from && st.dateKey < from) continue;
        if (to && st.dateKey > to) continue;
        responses += 1;
        dates.add(st.dateKey);
        const key = identityOf(header, r, cols);
        const p = people.get(key) || { key, employeeId: "", name: "", domain: "", email: "", days: {}, responses: 0, lastStamp: "" };
        p.days[st.dateKey] = (p.days[st.dateKey] || 0) + 1;
        p.responses += 1;
        const stamp = `${st.dateKey} ${st.clock}`;
        if (stamp >= p.lastStamp) {
            p.lastStamp = stamp;
            p.employeeId = valueOf(header, r, "employeeId", cols) || p.employeeId;
            p.name = valueOf(header, r, "name", cols) || p.name;
            p.domain = valueOf(header, r, "domain", cols) || p.domain;
            p.email = valueOf(header, r, "email", cols) || p.email;
        }
        people.set(key, p);
    }

    const list = [...people.values()].map((p) => {
        const marked = Object.keys(p.days);
        return {
            employeeId: p.employeeId, name: p.name, domain: p.domain, email: p.email,
            days: p.days,
            daysMarked: marked.length,
            daysComplete: marked.filter((d) => p.days[d] >= required).length,
            responses: p.responses,
        };
    }).sort((a, b) => (a.name || a.employeeId).localeCompare(b.name || b.employeeId));

    return {
        from: from || "", to: to || "", required,
        dates: [...dates].sort(),
        columns: cols.map((c) => c.label),
        dateFormat: fmt,
        people: list,
        responses,
        sheet: { header, rowCount: rows.length },
    };
}

// "softe" should find "Software Engineering": a substring match first, and
// failing that the query's characters in order inside the text with anything
// between them, which is what a half-typed or slightly mistyped word is.
function fuzzyMatch(needle, hay) {
    const n = String(needle || "").toLowerCase().replace(/[^a-z0-9]/g, "");
    const h = String(hay || "").toLowerCase().replace(/[^a-z0-9]/g, "");
    if (!n) return true;
    if (h.includes(n)) return true;
    let i = 0;
    for (const c of h) { if (c === n[i]) i += 1; if (i === n.length) return true; }
    return false;
}

// The search box is for domains: "s" offers every domain starting with s,
// "d" offers "Web Development" because a word of it does, and a half-typed
// "softe" still finds Software Engineering. Lower rank is a better match.
function domainRank(q, domain) {
    const n = String(q || "").trim().toLowerCase();
    const d = String(domain || "").trim().toLowerCase();
    if (!n || !d) return -1;
    if (d.startsWith(n)) return 0;
    if (d.split(/[^a-z0-9]+/).some((w) => w && w.startsWith(n))) return 1;
    if (d.includes(n)) return 2;
    if (fuzzyMatch(n, d)) return 3;
    return -1;
}

function domainMatches(q, domain) {
    return domainRank(q, domain) >= 0;
}

// Only the day range and the domain narrow the table; a student is found by
// scrolling, not by a filter on their name or id.
function matchesPerson(p, { domain, q } = {}) {
    const norm = (v) => String(v || "").trim().toLowerCase();
    if (domain && norm(p.domain) !== norm(domain)) return false;
    if (q && !domainMatches(q, p.domain)) return false;
    return true;
}

// A single person's days, found by employee id first and email second.
function personFor(list, { employeeId, email } = {}) {
    const norm = (v) => String(v || "").trim().toLowerCase();
    const id = norm(employeeId);
    const em = norm(email);
    return list.find((p) => id && norm(p.employeeId) === id)
        || list.find((p) => em && norm(p.email) === em)
        || null;
}

// Everyone who submitted the form on a day, once each, with first and last
// submission time and how many times they submitted.
async function responsesForDay(dateKey) {
    const { header, rows } = await fetchSheet();
    const s = settings();
    const idx = columnsOf(header);
    const fmt = s.dateFormat === "AUTO" ? detectDateFormat(rows, idx.date >= 0 ? idx.date : idx.ts) : s.dateFormat;
    const cols = pickColumns(header, s.columns);

    const people = new Map();
    let total = 0;
    for (const r of rows) {
        const st = stampOf(r, idx, fmt);
        if (!st || st.dateKey !== dateKey) continue;
        total += 1;
        const fields = cols.map((c) => ({ label: c.label, value: String(r[c.idx] || "").trim() }));
        const key = identityOf(header, r, cols);
        const p = people.get(key) || { key, fields, line: lineFor(fields), firstClock: st.clock, lastClock: st.clock, count: 0 };
        p.count += 1;
        if (st.clock < p.firstClock) p.firstClock = st.clock;
        if (st.clock > p.lastClock) p.lastClock = st.clock;
        people.set(key, p);
    }
    const respondents = [...people.values()].sort((a, b) => a.firstClock.localeCompare(b.firstClock));
    return {
        dateKey,
        totalResponses: total,
        uniqueRespondents: respondents.length,
        columns: cols.map((c) => c.label),
        dateFormat: fmt,
        respondents,
        sheet: { header, rowCount: rows.length },
    };
}

module.exports = {
    settings, exportUrl, isConfigured, fetchSheet, clearCache, responsesForDay,
    byPerson, matchesPerson, personFor, requiredPerDay, fuzzyMatch, domainRank, domainMatches,
    parseCsv, parseStamp, parseClock, columnsOf, stampOf, detectDateFormat, pickColumns, idFromUrl, gidFromUrl,
};
