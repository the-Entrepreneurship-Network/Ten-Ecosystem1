const mongoose = require("mongoose");

/*
 * What the AI Coordinator did: each chat answer, each hand-over to a human
 * coordinator, each reminder and each daily summary.
 *
 * The daily summary reads it ("what the AI answered", "hand-overs"), and the
 * reminders use `key` to go out once: a key is written before the reminder is
 * sent, so a second run, a restart or a second process finds it and skips.
 */
const aiCoordinatorLogSchema = new mongoose.Schema({
    kind:       { type: String, enum: ["answer", "handover", "reminder", "summary"], required: true },
    // Set only for things that must happen once, e.g. "inactive:TEN/WEB/1005:2026-11-24".
    key:        { type: String },
    employeeId: { type: String, default: "" },
    studentId:  { type: mongoose.Schema.Types.ObjectId, default: null },
    domain:     { type: String, default: "" },
    question:   { type: String, default: "" },
    reply:      { type: String, default: "" },
    // answer: saved | ai | unavailable | limit | image; handover: the reason;
    // reminder: inactive | week | weekly.
    source:     { type: String, default: "" },
    reason:     { type: String, default: "" },
    createdAt:  { type: Date, default: Date.now }
});

aiCoordinatorLogSchema.index({ key: 1 }, { unique: true, sparse: true });
aiCoordinatorLogSchema.index({ domain: 1, kind: 1, createdAt: -1 });
aiCoordinatorLogSchema.index({ employeeId: 1, createdAt: -1 });
// Kept four months: long enough for any summary or dispute, short enough that
// students' questions are not kept for ever.
aiCoordinatorLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: 120 * 24 * 3600 });

module.exports = mongoose.models.AiCoordinatorLog || mongoose.model("AiCoordinatorLog", aiCoordinatorLogSchema);
