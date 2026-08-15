const mongoose = require("mongoose");

/**
 * Somebody applying to a programme.
 *
 * POST /api/programs/:id/apply answered "Application submitted successfully!"
 * and wrote nothing. Anyone who used it is not on any list, and there is no way
 * to find out who they were — the requests were never recorded.
 */
const programApplicationSchema = new mongoose.Schema({
    programId:   { type: mongoose.Schema.Types.ObjectId, ref: "Program", required: true, index: true },
    programTitle:{ type: String, default: "" },

    // An applicant may be a signed-in student or a visitor off the public page,
    // so identity is captured by contact details and linked to an account when
    // one exists rather than requiring one.
    studentId:   { type: mongoose.Schema.Types.ObjectId, ref: "Student", default: null, index: true },
    employeeId:  { type: String, default: "", index: true },

    name:    { type: String, required: true, trim: true, maxlength: 200 },
    email:   { type: String, required: true, lowercase: true, trim: true, maxlength: 320, index: true },
    phone:   { type: String, default: "", trim: true, maxlength: 40 },
    college: { type: String, default: "", maxlength: 200 },
    message: { type: String, default: "", maxlength: 2000 },

    status: {
        type: String,
        enum: ["submitted", "shortlisted", "accepted", "rejected", "withdrawn"],
        default: "submitted",
        index: true
    },
    reviewedBy: { type: String, default: "" },
    reviewedAt: { type: Date,   default: null },
    reviewNote: { type: String, default: "", maxlength: 2000 },

    appliedAt: { type: Date, default: Date.now, index: true }
}, { timestamps: true });

// One application per email per programme — a double-click must not create two.
programApplicationSchema.index({ programId: 1, email: 1 }, { unique: true });
programApplicationSchema.index({ status: 1, appliedAt: -1 });

module.exports = mongoose.model("ProgramApplication", programApplicationSchema);
