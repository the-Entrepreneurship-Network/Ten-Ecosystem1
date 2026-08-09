const mongoose = require("mongoose");

/**
 * Feedback a student writes about their internship experience.
 *
 * Section 9 of the task document assumes HR already had a feedback view. It did
 * not: every "feedback" field in the portal today is *coordinator-to-student*
 * task feedback (Submission.feedback, StudentTaskProgress.coordinatorFeedback)
 * or the Star Performer rejection note. Student-to-TEN feedback did not exist
 * in any form, so this is new.
 *
 * All HR staff see all feedback — it is organisation-wide, never scoped to the
 * HR account that happens to open it.
 */
const studentFeedbackSchema = new mongoose.Schema({
    studentId:  { type: mongoose.Schema.Types.ObjectId, ref: "Student", required: true, index: true },
    employeeId: { type: String, required: true, index: true },
    studentName:{ type: String, default: "" },
    domain:     { type: String, default: "", index: true },
    tenure:     { type: String, default: "" },
    college:    { type: String, default: "" },

    message:    { type: String, required: true, maxlength: 4000 },
    rating:     { type: Number, min: 1, max: 5, default: null },

    // HR workflow. Feedback is not a ticket, but HR needs to track what they
    // have already looked at across a team of people.
    status:     { type: String, enum: ["new", "read", "actioned"], default: "new", index: true },
    readBy:     { type: String, default: "" },
    readAt:     { type: Date, default: null },
    hrNote:     { type: String, default: "" },

    submittedAt:{ type: Date, default: Date.now, index: true }
}, { timestamps: true });

// The HR list is "newest first", optionally filtered by status or domain.
studentFeedbackSchema.index({ submittedAt: -1 });
studentFeedbackSchema.index({ status: 1, submittedAt: -1 });

module.exports = mongoose.model("StudentFeedback", studentFeedbackSchema);
