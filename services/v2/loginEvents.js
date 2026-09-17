"use strict";

const mongoose = require("mongoose");
const LoginEvent = require("../../models/LoginEvent");
const { dateKeyFor, reportTimeZone } = require("../../utils/reportClock");

const USER_TYPES = new Set(LoginEvent.USER_TYPES || ["unknown"]);

function clientIp(req) {
    if (!req) return "";
    const fwd = req.headers && req.headers["x-forwarded-for"];
    if (fwd) return String(fwd).split(",")[0].trim();
    const raw = req.ip || (req.socket && req.socket.remoteAddress) || "";
    return String(raw).replace(/^::ffff:/, "");
}

// Which portal role a mongoose model represents. EcosystemUser carries the
// role on the document, so the document wins when it is one we know.
function typeFromModel(model, user) {
    const name = String((model && model.modelName) || "").toLowerCase();
    if (name === "ecosystemuser") {
        const role = String((user && user.role) || "").toLowerCase();
        return USER_TYPES.has(role) ? role : "ecosystem";
    }
    return USER_TYPES.has(name) ? name : "unknown";
}

// Fire-and-forget. A login must never wait on, or fail because of, the
// bookkeeping about it — so this returns a promise the caller may ignore,
// swallows every error, and skips entirely when the database is down.
function record(req, info = {}) {
    try {
        if (mongoose.connection.readyState !== 1) return Promise.resolve(null);
        const now = new Date();
        const userType = USER_TYPES.has(info.userType) ? info.userType : "unknown";
        const doc = {
            userType,
            userId:    String(info.userId || ""),
            label:     String(info.label || "").trim(),
            email:     String(info.email || "").trim().toLowerCase(),
            domain:    String(info.domain || ""),
            portal:    String(info.portal || (req && req.originalUrl) || ""),
            success:   info.success !== false,
            reason:    String(info.reason || ""),
            ip:        clientIp(req),
            userAgent: String((req && req.headers && req.headers["user-agent"]) || "").slice(0, 300),
            sessionId: String((req && req.sessionID) || ""),
            loginAt:   now,
            dateKey:   dateKeyFor(now, reportTimeZone()),
        };
        return LoginEvent.create(doc).catch((err) => {
            console.warn("[LOGIN-EVENT] not recorded:", err.message);
            return null;
        });
    } catch (err) {
        console.warn("[LOGIN-EVENT] not recorded:", err.message);
        return Promise.resolve(null);
    }
}

async function listByDay(dateKey, filters = {}) {
    const q = { dateKey };
    if (filters.userType) q.userType = filters.userType;
    if (typeof filters.success === "boolean") q.success = filters.success;
    if (filters.domain) q.domain = filters.domain;
    return LoginEvent.find(q).sort({ loginAt: 1 }).lean();
}

async function purgeOlderThan(days) {
    const cutoff = new Date(Date.now() - days * 86400000);
    const r = await LoginEvent.deleteMany({ loginAt: { $lt: cutoff } });
    return (r && r.deletedCount) || 0;
}

module.exports = { record, listByDay, purgeOlderThan, clientIp, typeFromModel };
