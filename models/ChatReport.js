"use strict";

/**
 * A report of inappropriate chat, raised by the person on the receiving end.
 *
 * Blocking protects the reporter immediately; reporting is what brings it to
 * someone with authority. The two are deliberately separate actions — a victim
 * should be able to stop the messages without also having to file a complaint,
 * and should be able to file one without waiting for anybody's permission.
 *
 * Reports surface in the admin portal. The reported message is copied in at
 * report time rather than referenced, so deleting the message cannot erase the
 * evidence of it.
 */

const mongoose = require("mongoose");

const chatReportSchema = new mongoose.Schema({
    reporterId:   { type: String, required: true, index: true },
    reporterName: { type: String, default: "" },
    reporterRole: { type: String, enum: ["student", "coordinator", "hr", "admin"], required: true },

    reportedId:   { type: String, required: true, index: true },
    reportedName: { type: String, default: "" },
    reportedRole: { type: String, enum: ["student", "coordinator", "hr", "admin"], default: "student" },

    chatRoom:     { type: String, default: "" },
    reason:       { type: String, default: "", maxlength: 2000 },

    // A copy, not a reference: a reported message that is later deleted must
    // still be readable by whoever reviews the report.
    messageId:      { type: mongoose.Schema.Types.ObjectId, ref: "Message", default: null },
    messageSnapshot:{ type: String, default: "" },
    messageSentAt:  { type: Date, default: null },

    status:      { type: String, enum: ["open", "reviewing", "actioned", "dismissed"], default: "open", index: true },
    reviewedBy:  { type: String, default: "" },
    reviewedAt:  { type: Date, default: null },
    reviewNote:  { type: String, default: "" },

    createdAt:   { type: Date, default: Date.now, index: true }
});

chatReportSchema.index({ status: 1, createdAt: -1 });
chatReportSchema.index({ reportedId: 1, status: 1 });

module.exports = mongoose.model("ChatReport", chatReportSchema);
