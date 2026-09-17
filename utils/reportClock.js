"use strict";

// Every date in the attendance agent is keyed by the calendar day in one
// timezone, chosen once. Login times are stored as UTC instants; which day
// they belong to is decided here, so a sign-in at 00:30 IST lands on the
// right day even when the server clock runs in UTC.

const DEFAULT_TZ = "Asia/Kolkata";

function reportTimeZone() {
    const tz = String(process.env.ATTENDANCE_TZ || DEFAULT_TZ).trim();
    try {
        new Intl.DateTimeFormat("en-US", { timeZone: tz });
        return tz;
    } catch (_) {
        return "UTC";
    }
}

function parts(date, tz) {
    const fmt = new Intl.DateTimeFormat("en-GB", {
        timeZone: tz,
        year: "numeric", month: "2-digit", day: "2-digit",
        hour: "2-digit", minute: "2-digit", second: "2-digit",
        hour12: false,
    });
    const out = {};
    for (const p of fmt.formatToParts(date)) {
        if (p.type !== "literal") out[p.type] = p.value;
    }
    // Some ICU builds print midnight as "24" with hour12:false.
    if (out.hour === "24") out.hour = "00";
    return out;
}

function dateKeyFor(date = new Date(), tz = reportTimeZone()) {
    const p = parts(date, tz);
    return `${p.year}-${p.month}-${p.day}`;
}

function clockFor(date = new Date(), tz = reportTimeZone()) {
    const p = parts(date, tz);
    return `${p.hour}:${p.minute}`;
}

function isDateKey(s) {
    return /^\d{4}-\d{2}-\d{2}$/.test(String(s || ""));
}

// Pure calendar arithmetic on the key itself; no timezone involved.
function shiftDateKey(dateKey, days) {
    const [y, m, d] = String(dateKey).split("-").map(Number);
    const t = Date.UTC(y, m - 1, d) + days * 86400000;
    return new Date(t).toISOString().slice(0, 10);
}

// Fixed English names rather than Intl: ICU builds disagree on "Sep" versus
// "Sept", and a report line should not depend on which Node built it.
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function humanDate(dateKey) {
    if (!isDateKey(dateKey)) return String(dateKey || "");
    const [y, m, d] = dateKey.split("-").map(Number);
    const at = new Date(Date.UTC(y, m - 1, d));
    return `${DAYS[at.getUTCDay()]}, ${d} ${MONTHS[m - 1]} ${y}`;
}

module.exports = { DEFAULT_TZ, reportTimeZone, dateKeyFor, clockFor, isDateKey, shiftDateKey, humanDate };
