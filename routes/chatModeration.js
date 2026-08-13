"use strict";

/**
 * Direct messages, personal blocking, abuse reports, and the admin desk.
 *
 * Group chat already existed. What was missing is everything a person needs
 * when a conversation goes wrong: a way to talk one-to-one, a way to stop
 * someone reaching them, a way to escalate it, and somewhere for that
 * escalation to land.
 *
 * Identity always comes from the session. A caller never names who they are.
 */

const express = require("express");
const router  = express.Router();

const Student    = require("../models/Student");
const Coordinator= require("../models/Coordinator");
const HR         = require("../models/HR");
const Message    = require("../models/Message");
const UserBlock  = require("../models/UserBlock");
const ChatReport = require("../models/ChatReport");
const ChatRead   = require("../models/ChatRead");

/** Who is calling, from the session alone. */
function identityOf(req) {
    const s = req.session || {};
    if (s.adminUser)   return { role: "admin",       id: s.adminUser.username || "admin", name: s.adminUser.username || "Admin", domain: "" };
    if (s.hr)          return { role: "hr",          id: s.hr.email || s.hr.username,     name: s.hr.name || s.hr.username,      domain: "" };
    if (s.coordinator) return { role: "coordinator", id: s.coordinator.email || s.coordinator.username, name: s.coordinator.name || s.coordinator.username, domain: s.coordinator.domain || "" };
    if (s.student)     return { role: "student",     id: s.student.employeeId,            name: s.student.name || s.student.employeeId, domain: s.student.domain || "" };
    return null;
}

function requireChatUser(req, res, next) {
    const me = identityOf(req);
    if (!me) return res.status(401).json({ success: false, message: "Please sign in to continue." });
    req.me = me;
    next();
}

function requireAdminUser(req, res, next) {
    if (!(req.session && req.session.adminUser)) {
        return res.status(401).json({ success: false, message: "Admin sign-in required." });
    }
    req.me = identityOf(req);
    next();
}

function dmRoomFor(a, b) {
    return "dm::" + [String(a), String(b)].sort().join("::");
}

/** A user id can contain /, . and @ — all meaningful inside a regex. */
function escapeRegex(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ════════════════════════════════════════════════════════════
// DIRECT MESSAGES
// ════════════════════════════════════════════════════════════

/**
 * GET /api/chat/directory — who this user may start a conversation with.
 *
 * Scoped deliberately: a student sees the staff who support them and peers in
 * their own domain, not all 776 interns. Staff and admins can search everyone,
 * because answering a student is their job.
 */
router.get("/directory", requireChatUser, async (req, res) => {
    try {
        const me = req.me;
        const q = String(req.query.q || "").trim();
        const rx = q ? new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i") : null;
        const people = [];

        const staffFilter = rx ? { $or: [{ name: rx }, { email: rx }, { username: rx }] } : {};
        const [coordinators, hrs] = await Promise.all([
            Coordinator.find(staffFilter).select("name email username domain").limit(50).lean(),
            HR.find(staffFilter).select("name email username").limit(50).lean()
        ]);
        for (const c of coordinators) {
            const id = c.email || c.username;
            if (id && id !== me.id) people.push({ id, name: c.name || id, role: "coordinator", domain: c.domain || "" });
        }
        for (const h of hrs) {
            const id = h.email || h.username;
            if (id && id !== me.id) people.push({ id, name: h.name || id, role: "hr", domain: "" });
        }

        const studentFilter = {};
        if (rx) studentFilter.$or = [{ name: rx }, { employeeId: rx }, { email: rx }];
        // A student may message peers in their own domain only.
        if (me.role === "student") studentFilter.domain = me.domain;
        if (me.role === "coordinator" && !rx) studentFilter.domain = me.domain;

        const students = await Student.find(studentFilter)
            .select("name firstName lastName employeeId domain").limit(60).lean();
        for (const s of students) {
            if (!s.employeeId || s.employeeId === me.id) continue;
            people.push({
                id: s.employeeId,
                name: (s.name || `${s.firstName || ""} ${s.lastName || ""}`).trim() || s.employeeId,
                role: "student",
                domain: s.domain || ""
            });
        }

        // Never offer someone this user has blocked, or who has blocked them.
        const hidden = await UserBlock.hiddenFor(me.id);
        const visible = people.filter(p => !hidden.has(p.id));

        res.json({ success: true, me: { id: me.id, role: me.role }, people: visible.slice(0, 100) });
    } catch (err) {
        console.error("[chat] directory failed:", err.message);
        res.status(500).json({ success: false, message: "Could not load the directory: " + err.message });
    }
});

/** POST /api/chat/dm/open { userId } — the room name for a 1:1 conversation. */
router.post("/dm/open", requireChatUser, async (req, res) => {
    try {
        const other = String(req.body && req.body.userId || "").trim();
        if (!other) return res.status(400).json({ success: false, message: "userId is required." });
        if (other === req.me.id) return res.status(400).json({ success: false, message: "You cannot message yourself." });

        const hidden = await UserBlock.hiddenFor(req.me.id);
        if (hidden.has(other)) {
            return res.status(403).json({ success: false, message: "This conversation is unavailable because one of you has blocked the other." });
        }
        res.json({ success: true, room: dmRoomFor(req.me.id, other) });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

/**
 * GET /api/chat/dm/threads — the conversation list, most recent first.
 *
 * This is the inbox: one row per conversation, with the last message, when it
 * arrived, and how many messages in it this person has not read.
 *
 * It used to read the newest 400 DM messages across the WHOLE portal and then
 * filter them down to the caller's own, which meant a busy day of other
 * people's conversations could push a user's own threads out of the window and
 * make them disappear from their inbox. The room list is now derived from rooms
 * the caller is actually in.
 */
router.get("/dm/threads", requireChatUser, async (req, res) => {
    try {
        const me = req.me;
        const hidden = await UserBlock.hiddenFor(me.id);

        // Rooms addressed to this person. The room name contains both ids, so
        // membership is a property of the name and needs no separate index.
        const idRx = escapeRegex(String(me.id));
        const roomFilter = me.role === "admin"
            ? { chatRoom: /^dm::/ }
            : { chatRoom: new RegExp("^dm::(" + idRx + "::|.*::" + idRx + "$)") };

        const rooms = await Message.distinct("chatRoom", roomFilter);
        if (!rooms.length) return res.json({ success: true, threads: [] });

        // Newest message per room, in one pass.
        const latest = await Message.aggregate([
            { $match: { chatRoom: { $in: rooms } } },
            { $sort: { timestamp: -1 } },
            { $group: {
                _id: "$chatRoom",
                senderId:   { $first: "$senderId" },
                senderName: { $first: "$senderName" },
                message:    { $first: "$message" },
                imageUrl:   { $first: "$imageUrl" },
                timestamp:  { $first: "$timestamp" },
                expiresAt:  { $first: "$expiresAt" }
            } },
            { $sort: { timestamp: -1 } },
            { $limit: 120 }
        ]);

        const readMap = await ChatRead.mapFor(me.id, latest.map(l => l._id));

        const threads = [];
        for (const row of latest) {
            const parts = String(row._id).slice(4).split("::");
            if (parts.length !== 2) continue;
            const other = parts.find(p => p !== String(me.id)) || parts[0];
            if (hidden.has(other)) continue;

            const lastRead = readMap[row._id] || new Date(0);
            const unread = await Message.countDocuments({
                chatRoom: row._id,
                senderId: { $ne: me.id },
                timestamp: { $gt: lastRead }
            });

            threads.push({
                room: row._id,
                withId: other,
                // The name is only known from a message the OTHER person sent;
                // when every message is ours, fall back to their id and let the
                // profile lookup fill it in.
                withName: row.senderId === me.id ? other : (row.senderName || other),
                lastMessage: row.imageUrl && !row.message ? "\uD83D\uDCF7 Photo" : (row.message || "").slice(0, 90),
                lastFromMe: row.senderId === me.id,
                at: row.timestamp,
                unread,
                // So the UI can warn before a conversation ages out.
                expiresAt: row.expiresAt || null
            });
        }

        res.json({
            success: true,
            threads: threads.slice(0, 60),
            retentionDays: Message.DM_RETENTION_DAYS
        });
    } catch (err) {
        console.error("[chat] threads failed:", err.message);
        res.status(500).json({ success: false, message: err.message, threads: [] });
    }
});

/**
 * POST /api/chat/dm/read { room } — mark a conversation as read up to now.
 */
router.post("/dm/read", requireChatUser, async (req, res) => {
    try {
        const room = String(req.body && req.body.room || "").trim();
        if (!room.startsWith("dm::")) return res.status(400).json({ success: false, message: "room is required." });
        if (req.me.role !== "admin" && room.slice(4).split("::").indexOf(String(req.me.id)) === -1) {
            return res.status(403).json({ success: false, message: "Not your conversation." });
        }
        await ChatRead.markRead(req.me.id, room, new Date());
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

/** GET /api/chat/unread — total unread across every conversation, for a badge. */
router.get("/unread", requireChatUser, async (req, res) => {
    try {
        const me = req.me;
        const idRx = escapeRegex(String(me.id));
        const rooms = await Message.distinct("chatRoom", {
            chatRoom: new RegExp("^dm::(" + idRx + "::|.*::" + idRx + "$)")
        });
        if (!rooms.length) return res.json({ success: true, unread: 0 });

        const readMap = await ChatRead.mapFor(me.id, rooms);
        let total = 0;
        for (const room of rooms) {
            total += await Message.countDocuments({
                chatRoom: room,
                senderId: { $ne: me.id },
                timestamp: { $gt: readMap[room] || new Date(0) }
            });
        }
        res.json({ success: true, unread: total });
    } catch (err) {
        res.json({ success: true, unread: 0 });
    }
});

/**
 * GET /api/chat/profile/:userId — the person on the other side of a thread.
 *
 * Deliberately narrow. A profile card exists so you know who you are talking
 * to; it is not a route into someone's record, so it returns what a colleague
 * would reasonably see and nothing else. No email or phone for a student unless
 * the viewer is staff, and never a password, document or attendance figure.
 */
router.get("/profile/:userId", requireChatUser, async (req, res) => {
    try {
        const wanted = decodeURIComponent(req.params.userId || "").trim();
        if (!wanted) return res.status(400).json({ success: false, message: "userId is required." });

        const hidden = await UserBlock.hiddenFor(req.me.id);
        if (hidden.has(wanted)) {
            return res.status(403).json({ success: false, message: "This profile is unavailable." });
        }

        const isStaff = ["hr", "coordinator", "admin"].indexOf(req.me.role) !== -1;

        const student = await Student.findOne({ employeeId: wanted })
            .select("name firstName lastName employeeId domain domains collegeName college tenure joiningDate email whatsapp")
            .lean();
        if (student) {
            return res.json({ success: true, profile: {
                id: student.employeeId,
                name: (student.name || `${student.firstName || ""} ${student.lastName || ""}`).trim() || student.employeeId,
                role: "student",
                domain: student.domain || "",
                domains: Array.isArray(student.domains) && student.domains.length ? student.domains : [student.domain].filter(Boolean),
                college: student.collegeName || student.college || "",
                tenure: student.tenure || "",
                joinedOn: student.joiningDate || "",
                email: isStaff ? (student.email || "") : "",
                phone: isStaff ? (student.whatsapp || "") : ""
            } });
        }

        const coord = await Coordinator.findOne({ $or: [{ email: wanted }, { username: wanted }] })
            .select("name email username domain").lean();
        if (coord) {
            return res.json({ success: true, profile: {
                id: coord.email || coord.username,
                name: coord.name || coord.username || coord.email,
                role: "coordinator",
                domain: coord.domain || "",
                email: coord.email || ""
            } });
        }

        const hr = await HR.findOne({ $or: [{ email: wanted }, { username: wanted }] })
            .select("name email username").lean();
        if (hr) {
            return res.json({ success: true, profile: {
                id: hr.email || hr.username,
                name: hr.name || hr.username || hr.email,
                role: "hr",
                email: hr.email || ""
            } });
        }

        res.status(404).json({ success: false, message: "No profile found for that person." });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// ════════════════════════════════════════════════════════════
// BLOCK
// ════════════════════════════════════════════════════════════

/** POST /api/chat/block { userId, userName, userRole } */
router.post("/block", requireChatUser, async (req, res) => {
    try {
        const target = String(req.body && req.body.userId || "").trim();
        if (!target) return res.status(400).json({ success: false, message: "userId is required." });
        if (target === req.me.id) return res.status(400).json({ success: false, message: "You cannot block yourself." });

        await UserBlock.updateOne(
            { blockerId: req.me.id, blockedId: target },
            { $setOnInsert: {
                blockerId: req.me.id, blockerRole: req.me.role, blockerName: req.me.name,
                blockedId: target,
                blockedRole: ["student","coordinator","hr","admin"].includes(req.body.userRole) ? req.body.userRole : "student",
                blockedName: String(req.body.userName || target).slice(0, 120),
                createdAt: new Date()
            } },
            { upsert: true }
        );
        res.json({ success: true, message: "Blocked. You will no longer see their messages, and they will not see yours." });
    } catch (err) {
        console.error("[chat] block failed:", err.message);
        res.status(500).json({ success: false, message: "Could not block: " + err.message });
    }
});

/** POST /api/chat/unblock { userId } */
router.post("/unblock", requireChatUser, async (req, res) => {
    try {
        const target = String(req.body && req.body.userId || "").trim();
        await UserBlock.deleteOne({ blockerId: req.me.id, blockedId: target });
        res.json({ success: true, message: "Unblocked." });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

/** GET /api/chat/blocks — who this user has blocked. */
router.get("/blocks", requireChatUser, async (req, res) => {
    try {
        const rows = await UserBlock.find({ blockerId: req.me.id })
            .select("blockedId blockedName blockedRole createdAt -_id")
            .sort({ createdAt: -1 }).lean();
        res.json({ success: true, blocks: rows });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// ════════════════════════════════════════════════════════════
// REPORT
// ════════════════════════════════════════════════════════════

/** POST /api/chat/report { userId, userName, userRole, reason, messageId, room } */
router.post("/report", requireChatUser, async (req, res) => {
    try {
        const body = req.body || {};
        const target = String(body.userId || "").trim();
        if (!target) return res.status(400).json({ success: false, message: "userId is required." });
        if (target === req.me.id) return res.status(400).json({ success: false, message: "You cannot report yourself." });

        // Copy the message rather than reference it: deleting a message must
        // not erase the evidence a report was raised about.
        let snapshot = "", sentAt = null, messageId = null;
        if (body.messageId) {
            try {
                const msg = await Message.findById(body.messageId).lean();
                if (msg) {
                    messageId = msg._id;
                    snapshot = (msg.message || (msg.imageUrl ? "[image]" : "")).slice(0, 2000);
                    sentAt = msg.timestamp;
                }
            } catch (_) {}
        }

        const report = await ChatReport.create({
            reporterId: req.me.id, reporterName: req.me.name, reporterRole: req.me.role,
            reportedId: target,
            reportedName: String(body.userName || target).slice(0, 120),
            reportedRole: ["student","coordinator","hr","admin"].includes(body.userRole) ? body.userRole : "student",
            chatRoom: String(body.room || "").slice(0, 200),
            reason: String(body.reason || "").slice(0, 2000),
            messageId, messageSnapshot: snapshot, messageSentAt: sentAt
        });

        res.json({
            success: true,
            message: "Reported. An admin will review this. You can also block this person so they cannot message you meanwhile.",
            reportId: report._id
        });
    } catch (err) {
        console.error("[chat] report failed:", err.message);
        res.status(500).json({ success: false, message: "Could not submit the report: " + err.message });
    }
});

// ════════════════════════════════════════════════════════════
// ADMIN DESK
// ════════════════════════════════════════════════════════════

/** GET /api/chat/admin/reports?status=open */
router.get("/admin/reports", requireAdminUser, async (req, res) => {
    try {
        const status = ["open", "reviewing", "actioned", "dismissed"].includes(req.query.status)
            ? req.query.status : "open";
        const [reports, openCount] = await Promise.all([
            ChatReport.find({ status }).sort({ createdAt: -1 }).limit(200).lean(),
            ChatReport.countDocuments({ status: "open" })
        ]);
        res.json({ success: true, status, openCount, reports });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

/** POST /api/chat/admin/reports/:id { status, note } */
router.post("/admin/reports/:id", requireAdminUser, async (req, res) => {
    try {
        const status = req.body && req.body.status;
        if (!["reviewing", "actioned", "dismissed"].includes(status)) {
            return res.status(400).json({ success: false, message: "status must be reviewing, actioned or dismissed." });
        }
        const updated = await ChatReport.findByIdAndUpdate(req.params.id, {
            status,
            reviewedBy: req.me.id,
            reviewedAt: new Date(),
            reviewNote: String((req.body && req.body.note) || "").slice(0, 2000)
        }, { new: true });
        if (!updated) return res.status(404).json({ success: false, message: "Report not found." });
        res.json({ success: true, report: updated });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

/**
 * GET /api/chat/admin/rooms — every room with traffic, for oversight.
 * Admins can then open any of them, including private conversations.
 */
router.get("/admin/rooms", requireAdminUser, async (req, res) => {
    try {
        const rooms = await Message.aggregate([
            { $group: { _id: "$chatRoom", messages: { $sum: 1 }, last: { $max: "$timestamp" } } },
            { $sort: { last: -1 } },
            { $limit: 200 }
        ]);
        res.json({
            success: true,
            rooms: rooms.map(r => ({
                room: r._id,
                isPrivate: String(r._id).indexOf("dm::") === 0,
                messages: r.messages,
                last: r.last
            }))
        });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

module.exports = router;
