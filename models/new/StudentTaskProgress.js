// NEW FEATURE: Student Task Progress Tracking
const mongoose = require("mongoose");

const studentTaskProgressSchema = new mongoose.Schema({
    studentId:           { type: mongoose.Schema.Types.ObjectId, ref: "Student", required: true },
    taskId:              { type: mongoose.Schema.Types.ObjectId, ref: "DomainTask", required: true },
    status:              { type: String, enum: ["locked", "available", "in_progress", "submitted", "approved", "rejected"], default: "locked" },
    startedAt:           { type: Date, default: null },
    submittedAt:         { type: Date, default: null },
    approvedAt:          { type: Date, default: null },
    approvedBy:          { type: mongoose.Schema.Types.ObjectId, ref: "Coordinator", default: null },
    submissionUrl:       { type: String, default: null },
    submissionNotes:     { type: String, default: null },
    coordinatorFeedback: { type: String, default: null },
    coinsAwarded:        { type: Number, default: 0 },
    videoWatchedPercent: { type: Number, default: 0 },
    skipVideoLogged:     { type: Boolean, default: false },

    // NEW FEATURE: Quiz System
    quiz_attempts:        { type: Number, default: 0 },
    quiz_last_attempt_at: { type: Date, default: null },
    quiz_locked_until:    { type: Date, default: null },
    quiz_passed:          { type: Boolean, default: false },
    quiz_best_score:      { type: Number, default: 0 },
    quiz_pass_score:      { type: Number, default: 0 },

    // NEW FEATURE: Quiz System (attempt session + anti-refresh + "no same set twice in a row")
    quiz_current_question_ids: { type: [mongoose.Schema.Types.ObjectId], default: [] },
    quiz_current_expires_at:   { type: Date, default: null },
    quiz_last_question_ids:    { type: [mongoose.Schema.Types.ObjectId], default: [] }
}, { timestamps: true });

studentTaskProgressSchema.index({ studentId: 1, taskId: 1 }, { unique: true });
studentTaskProgressSchema.index({ studentId: 1, status: 1 });
studentTaskProgressSchema.index({ approvedBy: 1, status: 1 });

module.exports = mongoose.model("StudentTaskProgress", studentTaskProgressSchema);
