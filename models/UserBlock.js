"use strict";

/**
 * One person blocking another, everywhere — not per room.
 *
 * BlockList already existed but solves a different problem: it lets a
 * coordinator or HR silence someone inside one room, and students cannot use
 * it at all. That is moderation, applied downward.
 *
 * This is the protection a person applies for themselves. Any role may block
 * any other, including a student blocking a member of staff, and it holds in
 * every room and in direct messages. Blocking is mutual in effect: once A
 * blocks B, neither sees the other's messages, so a blocked person cannot tell
 * they were blocked by watching whose messages still arrive.
 *
 * Ids are whatever identifies the user in chat — employeeId for students,
 * username or email for coordinators and HR — matching Message.senderId.
 */

const mongoose = require("mongoose");

const userBlockSchema = new mongoose.Schema({
    blockerId:   { type: String, required: true, index: true },
    blockerRole: { type: String, enum: ["student", "coordinator", "hr", "admin"], required: true },
    blockerName: { type: String, default: "" },

    blockedId:   { type: String, required: true, index: true },
    blockedRole: { type: String, enum: ["student", "coordinator", "hr", "admin"], default: "student" },
    blockedName: { type: String, default: "" },

    createdAt:   { type: Date, default: Date.now }
});

// Blocking the same person twice is a no-op, not an error.
userBlockSchema.index({ blockerId: 1, blockedId: 1 }, { unique: true });

/**
 * Every id this user cannot see, and who cannot see them — one query.
 * Used to filter history and to decide whether a live message is delivered.
 */
userBlockSchema.statics.hiddenFor = async function (userId) {
    if (!userId) return new Set();
    const rows = await this.find({
        $or: [{ blockerId: userId }, { blockedId: userId }]
    }).select("blockerId blockedId -_id").lean();

    const hidden = new Set();
    for (const r of rows) {
        hidden.add(r.blockerId === userId ? r.blockedId : r.blockerId);
    }
    return hidden;
};

module.exports = mongoose.model("UserBlock", userBlockSchema);
