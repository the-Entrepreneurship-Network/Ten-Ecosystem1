"use strict";

/**
 * A student's request for a specific certificate.
 *
 * Certificates were previously only ever pushed by HR or a cron. There was no
 * way for a student to say "I have met the bar, please issue mine", and no
 * queue for HR to work through per certificate type — the single Pending
 * Documents list only ever held offer-letter uploads.
 *
 * Eligibility is re-checked on the server at apply time AND again at approval
 * time (services/certificateEligibility.js). The client only ever decides
 * whether to show a button; it never decides whether a student qualifies.
 */

const mongoose = require("mongoose");

const certificateApplicationSchema = new mongoose.Schema({
    studentId:   { type: mongoose.Schema.Types.ObjectId, ref: "Student", required: true },
    employeeId:  { type: String, required: true, index: true },
    studentName: { type: String, default: "" },
    domain:      { type: String, default: "" },

    // Which certificate. STAR is included because a student applies for it
    // only after HR has accepted their contribution — the acceptance and the
    // certificate are two separate decisions.
    certificateType: {
        type: String,
        enum: ["LOC", "LOR", "STAR"],
        required: true
    },

    status: {
        type: String,
        enum: ["pending", "approved", "rejected", "issued"],
        default: "pending",
        index: true
    },

    // What the numbers were when they applied. Kept so HR reviews the same
    // figures the student saw, rather than whatever they have drifted to by
    // the time someone opens the queue.
    snapshot: {
        attendancePercentage: { type: Number, default: 0 },
        performanceScore:     { type: Number, default: 0 },
        internshipCompleted:  { type: Boolean, default: false },
        taskCompletionPercent:{ type: Number, default: 0 }
    },

    appliedAt:   { type: Date, default: Date.now },
    reviewedAt:  { type: Date, default: null },
    reviewedBy:  { type: String, default: "" },
    reviewNote:  { type: String, default: "" },

    issuedAt:        { type: Date, default: null },
    documentNumber:  { type: String, default: null }
}, { timestamps: true });

// One live application per student per certificate. A student may re-apply
// after a rejection, so the guard is enforced in the route against pending /
// approved / issued rather than by a blanket unique index.
certificateApplicationSchema.index({ studentId: 1, certificateType: 1, status: 1 });
certificateApplicationSchema.index({ certificateType: 1, status: 1, appliedAt: -1 });

module.exports = mongoose.model("CertificateApplication", certificateApplicationSchema);
