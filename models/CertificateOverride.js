"use strict";

/**
 * A certificate HR issued without the student meeting the normal requirements.
 *
 * Many interns finished their internship entirely over WhatsApp: there was no
 * portal application, no task journey and no attendance record for them, so
 * every eligibility check the portal runs says no. They still earned the
 * certificate. HR therefore needs a way to issue one directly — and the moment
 * that way exists, it needs to be visible, because "HR can issue any
 * certificate to anyone" with no record is how a certificate stops meaning
 * anything.
 *
 * So every direct issue writes one of these rows, whether or not the student
 * met the bar, and the admin portal lists them. The row keeps the measured
 * values AT THE TIME of issue — attendance and performance both move — so
 * "issued at 41% attendance" stays true in the record even after the number
 * changes underneath it.
 */

const mongoose = require("mongoose");

const CertificateOverrideSchema = new mongoose.Schema({
    studentId:   { type: mongoose.Schema.Types.ObjectId, ref: "Student", index: true },
    employeeId:  { type: String, required: true, index: true },
    studentName: { type: String, default: "" },
    domain:      { type: String, default: "" },

    certificateType: {
        type: String,
        required: true,
        enum: ["LOC", "LOR", "STAR", "OFFER", "LOP"],
        index: true
    },

    /** Who issued it. Identity comes from the session, never from the body. */
    issuedBy:      { type: String, default: "" },
    issuedByRole:  { type: String, default: "hr" },

    /**
     * Whether the student actually met the requirements at the time.
     * `false` means HR saw the warning and went ahead anyway — those are the
     * rows an admin is really looking for.
     */
    metRequirements: { type: Boolean, default: false, index: true },

    /** The specific checks that failed, in the words the warning used. */
    failedChecks: { type: [String], default: [] },

    /** Measured values at the moment of issue. */
    snapshot: {
        attendancePercentage: { type: Number, default: 0 },
        performanceScore:     { type: Number, default: 0 },
        taskCompletionPct:    { type: Number, default: 0 },
        internshipCompleted:  { type: Boolean, default: false },
        hadApplication:       { type: Boolean, default: false }
    },

    /** Free text HR typed when confirming the warning. */
    reason: { type: String, default: "" },

    /** Set if the certificate is later revoked from the admin portal. */
    revokedAt:     { type: Date, default: null },
    revokedBy:     { type: String, default: "" },
    revokeReason:  { type: String, default: "" },

    issuedAt: { type: Date, default: Date.now, index: true }
}, { timestamps: true });

CertificateOverrideSchema.index({ issuedAt: -1 });

module.exports = mongoose.models.CertificateOverride
    || mongoose.model("CertificateOverride", CertificateOverrideSchema);
