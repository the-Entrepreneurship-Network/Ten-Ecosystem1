"use strict";
const mongoose = require("mongoose");

const certificateRequestSchema = new mongoose.Schema({
    studentId:               { type: mongoose.Schema.Types.ObjectId, ref: "Student", required: true },
    domain:                  { type: String, default: "" },
    requestedAt:             { type: Date, default: Date.now },

    coordinatorDeadline:     { type: Date },
    coordinatorApproved:     { type: Boolean, default: false },
    coordinatorApprovedAt:   { type: Date },
    coordinatorAutoApproved: { type: Boolean, default: false },
    coordinatorNotes:        { type: String, default: "" },

    hrDeadline:              { type: Date },
    hrApproved:              { type: Boolean, default: false },
    hrApprovedAt:            { type: Date },
    hrAutoApproved:          { type: Boolean, default: false },
    hrNotes:                 { type: String, default: "" },

    approveLoC:              { type: Boolean, default: null },
    approveLor:              { type: Boolean, default: null },
    approveStarPerformance:  { type: Boolean, default: null },

    status: {
        type: String,
        enum: ["awaiting_coordinator", "awaiting_hr", "generating", "completed", "failed"],
        default: "awaiting_coordinator"
    },

    locEligible:             { type: Boolean, default: false },
    lorEligible:             { type: Boolean, default: false },
    starPerformanceGrade:    { type: String, default: "" },
    starPerformanceLabel:    { type: String, default: "" },

    processed:               { type: Boolean, default: false },
    createdAt:               { type: Date, default: Date.now }
});

certificateRequestSchema.index({ studentId: 1 });
certificateRequestSchema.index({ status: 1 });
certificateRequestSchema.index({ coordinatorDeadline: 1 });
certificateRequestSchema.index({ hrDeadline: 1 });

module.exports = mongoose.model("CertificateRequest", certificateRequestSchema);
