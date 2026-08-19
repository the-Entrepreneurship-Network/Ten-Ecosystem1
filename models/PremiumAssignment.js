"use strict";

/**
 * What a coordinator sends privately to a premium student — a note, or a
 * project to build.
 *
 * One collection for both because they are the same conversation: a coordinator
 * writes to one student, the student sees it in their premium section, and a
 * project is simply a note that expects something back. Splitting them would
 * mean two models, two routes and two lists that have to be merged for display
 * anyway.
 *
 * `kind` decides which fields matter:
 *
 *   note     title + body. Nothing comes back. `status` stays "sent".
 *   project  title + body + optional dueAt. The student submits a link, the
 *            coordinator reviews it, and `status` walks
 *            assigned → submitted → approved | changes_requested.
 *
 * This is deliberately separate from the ordinary task journey (DomainTask /
 * StudentTaskProgress). Those are the same for everyone on a domain and are
 * generated; these are hand-written by a coordinator for one paying student,
 * and mixing them would put personal notes into a shared task pipeline.
 */

const mongoose = require("mongoose");

const premiumAssignmentSchema = new mongoose.Schema({
    // Who it is for. employeeId is the handle every staff screen already uses;
    // studentId is kept for joins and survives an employeeId being corrected.
    studentId:  { type: mongoose.Schema.Types.ObjectId, ref: "Student", index: true },
    employeeId: { type: String, required: true, index: true, trim: true },

    kind: { type: String, enum: ["note", "project"], default: "note", index: true },

    title: { type: String, required: true, trim: true, maxlength: 200 },
    body:  { type: String, default: "", maxlength: 5000 },

    // Projects only.
    dueAt:         { type: Date,   default: null },
    submissionUrl: { type: String, default: "", maxlength: 2000 },
    submittedAt:   { type: Date,   default: null },
    feedback:      { type: String, default: "", maxlength: 2000 },
    reviewedAt:    { type: Date,   default: null },

    status: {
        type: String,
        enum: ["sent", "assigned", "submitted", "approved", "changes_requested"],
        default: "sent",
        index: true
    },

    /** Identity comes from the coordinator's session, never from the body. */
    createdBy:       { type: String, default: "" },
    createdByDomain: { type: String, default: "" },

    /** Cleared when the student opens their premium section. */
    readAt: { type: Date, default: null }
}, { timestamps: true });

// The student's own list: newest first, for one student.
premiumAssignmentSchema.index({ employeeId: 1, createdAt: -1 });
// The coordinator's queue: what is waiting on a review.
premiumAssignmentSchema.index({ createdByDomain: 1, status: 1, createdAt: -1 });

module.exports = mongoose.model("PremiumAssignment", premiumAssignmentSchema);
