"use strict";

const mongoose = require("mongoose");

// The agent's settings, from two places with a fixed precedence: an
// environment variable when it is set, else the document HR saved from the
// portal. Read synchronously from a cache so the code paths that build the
// report never wait on the database; the cache is refreshed on save, at
// start, and every minute.

const FIELDS = ["sheetUrl", "reportTo", "reportTime", "requiredPerDay", "whatsappToken", "phoneNumberId", "n8nWebhookUrl"];

// Which environment variables lock each field.
const ENV = {
    sheetUrl:       ["ATTENDANCE_SHEET_URL", "ATTENDANCE_SHEET_ID", "ATTENDANCE_SHEET_CSV_URL"],
    reportTo:       ["ATTENDANCE_REPORT_TO"],
    reportTime:     ["ATTENDANCE_REPORT_CRON"],
    requiredPerDay: ["ATTENDANCE_REQUIRED_PER_DAY"],
    whatsappToken:  ["WHATSAPP_TOKEN"],
    phoneNumberId:  ["WHATSAPP_PHONE_NUMBER_ID"],
    n8nWebhookUrl:  ["N8N_ATTENDANCE_WEBHOOK_URL"],
};

const EMPTY = Object.freeze(Object.fromEntries(FIELDS.map((f) => [f, f === "requiredPerDay" ? 0 : ""])));

let cache = { ...EMPTY };
let timer = null;
const listeners = new Set();

function model() { return require("../../models/AttendanceSettings"); }
function dbReady() { return mongoose.connection.readyState === 1; }
function env(name) { return String(process.env[name] || "").trim(); }

function envSet(field) {
    return (ENV[field] || []).some((k) => env(k) !== "");
}

function timeFromCron(cron) {
    const m = String(cron || "").trim().match(/^(\d{1,2})\s+(\d{1,2})\s+\*\s+\*\s+\*$/);
    if (!m || Number(m[1]) > 59 || Number(m[2]) > 23) return "";
    return `${String(m[2]).padStart(2, "0")}:${String(m[1]).padStart(2, "0")}`;
}

function cronFromTime(time) {
    const m = String(time || "").trim().match(/^(\d{1,2}):(\d{2})$/);
    if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) return "";
    return `${Number(m[2])} ${Number(m[1])} * * *`;
}

function envValue(field) {
    if (field === "sheetUrl") {
        return env("ATTENDANCE_SHEET_URL") || env("ATTENDANCE_SHEET_CSV_URL")
            || (env("ATTENDANCE_SHEET_ID") ? `https://docs.google.com/spreadsheets/d/${env("ATTENDANCE_SHEET_ID")}/edit` : "");
    }
    if (field === "reportTime") return timeFromCron(env("ATTENDANCE_REPORT_CRON")) || env("ATTENDANCE_REPORT_CRON");
    if (field === "requiredPerDay") return parseInt(env("ATTENDANCE_REQUIRED_PER_DAY"), 10) || 0;
    return env(ENV[field][0]);
}

/** The stored values as last loaded. */
function current() { return { ...cache }; }

/** One stored value, for the synchronous readers: `process.env.X || fromDb("x")`. */
function fromDb(field) { return cache[field]; }

/** Stored values with the environment laid over them, and where each came from. */
function effective() {
    const values = {};
    const source = {};
    for (const f of FIELDS) {
        if (envSet(f)) { values[f] = envValue(f); source[f] = "env"; }
        else if (cache[f] !== "" && cache[f] !== 0) { values[f] = cache[f]; source[f] = "db"; }
        else { values[f] = EMPTY[f]; source[f] = "none"; }
    }
    return { values, source };
}

async function load() {
    if (!dbReady()) return current();
    try {
        const doc = await model().findOne({ key: "default" }).lean();
        const next = { ...EMPTY };
        if (doc) for (const f of FIELDS) if (doc[f] !== undefined && doc[f] !== null) next[f] = doc[f];
        const changed = JSON.stringify(next) !== JSON.stringify(cache);
        cache = next;
        if (changed) notify();
    } catch (err) {
        console.warn("[ATTENDANCE-SETTINGS] not loaded:", err.message);
    }
    return current();
}

function validate(patch) {
    const out = {};
    const errors = [];
    const has = (k) => patch[k] !== undefined;

    if (has("sheetUrl")) {
        const v = String(patch.sheetUrl || "").trim();
        const ok = !v || /\/spreadsheets\/d\/[A-Za-z0-9_-]+/.test(v) || /^https?:\/\/\S+\.csv(\?\S*)?$/i.test(v) || /export\?format=csv/.test(v);
        if (ok) out.sheetUrl = v; else errors.push("sheetUrl must be a Google Sheets link (/spreadsheets/d/...) or a CSV URL");
    }
    if (has("reportTo")) {
        const parts = String(patch.reportTo || "").split(/[,;\n]+/).map((p) => p.replace(/\D/g, "")).filter(Boolean);
        if (parts.some((p) => p.length < 8 || p.length > 15)) errors.push("reportTo must be phone numbers with the country code, digits only");
        else out.reportTo = parts.join(",");
    }
    if (has("reportTime")) {
        const v = String(patch.reportTime || "").trim();
        if (v && !cronFromTime(v)) errors.push("reportTime must be HH:MM (24-hour)");
        else out.reportTime = v;
    }
    if (has("requiredPerDay")) {
        const raw = patch.requiredPerDay;
        if (raw === "" || raw === null) out.requiredPerDay = 0;
        else {
            const n = parseInt(raw, 10);
            if (!Number.isFinite(n) || n < 1 || n > 10) errors.push("requiredPerDay must be between 1 and 10");
            else out.requiredPerDay = n;
        }
    }
    for (const f of ["whatsappToken", "phoneNumberId", "n8nWebhookUrl"]) {
        if (has(f)) out[f] = String(patch[f] || "").trim();
    }
    if (out.phoneNumberId && !/^\d{5,20}$/.test(out.phoneNumberId)) errors.push("phoneNumberId must be digits");
    if (out.n8nWebhookUrl && !/^https?:\/\//i.test(out.n8nWebhookUrl)) errors.push("n8nWebhookUrl must be an http(s) URL");
    return { values: out, errors };
}

async function save(patch, by = "") {
    const { values, errors } = validate(patch || {});
    if (errors.length) {
        const e = new Error(errors.join("; "));
        e.status = 400;
        e.errors = errors;
        throw e;
    }
    if (!dbReady()) {
        const e = new Error("database not connected; settings cannot be saved");
        e.status = 503;
        throw e;
    }
    await model().updateOne(
        { key: "default" },
        { $set: { ...values, updatedBy: String(by || ""), updatedAt: new Date() } },
        { upsert: true },
    );
    await load();
    return current();
}

function onChange(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
}

function notify() {
    for (const fn of listeners) {
        try { fn(current()); } catch (err) { console.warn("[ATTENDANCE-SETTINGS] listener failed:", err.message); }
    }
}

function startRefresh(ms = 60000) {
    stopRefresh();
    timer = setInterval(() => { load().catch(() => {}); }, ms);
    if (timer.unref) timer.unref();
    return timer;
}

function stopRefresh() {
    if (timer) clearInterval(timer);
    timer = null;
}

// Last four characters only; enough to tell two tokens apart, never enough to use.
function mask(secret) {
    const s = String(secret || "");
    if (!s) return "";
    return "*".repeat(Math.max(4, Math.min(8, s.length - 4))) + s.slice(-4);
}

function _reset() {
    cache = { ...EMPTY };
    listeners.clear();
    stopRefresh();
}

module.exports = {
    FIELDS, ENV,
    current, fromDb, effective, envSet, envValue,
    load, save, validate, onChange, startRefresh, stopRefresh,
    cronFromTime, timeFromCron, mask, _reset,
};
