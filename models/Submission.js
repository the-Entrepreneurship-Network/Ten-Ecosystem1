const mongoose = require("mongoose");

const submissionSchema = new mongoose.Schema({
    employeeId: { type: String, index: true },
    domain: String,
    task: String,
    githubLink: String,
    note: String,
    image: String,
    pdf: String,
    feedback: { type: String, default: "No Feedback Yet" },
    status: { type: String, default: "Pending" },
    reviewedOnce: { type: Boolean, default: false },
    attendanceAllowed: { type: Boolean, default: false },
    attendanceGiven: { type: Boolean, default: false },
    attendanceCount: { type: Number, default: 0 },
    coordinatorRating: { type: Number, default: 0, min: 0, max: 5 },
    internshipDuration: { type: String, default: "1 Month" },
    monthlyAttendance: {
        month1: { type: Number, default: 0 },
        month2: { type: Number, default: 0 },
        month3: { type: Number, default: 0 },
        month4: { type: Number, default: 0 },
        month5: { type: Number, default: 0 },
        month6: { type: Number, default: 0 }
    },
    meetingsJoined: { type: Number, default: 0 },
    tasksCompleted: { type: Number, default: 0 },
    performance: { type: String, default: "B" },
    submittedAt: { type: Date, default: Date.now },
    isOverdue: { type: Boolean, default: false },
    isCaseStudy: { type: Boolean, default: false },
    aiFeedback: { type: Boolean, default: false },
    feedbackGeneratedAt: { type: Date, default: null }
});

module.exports = mongoose.models.Submission || mongoose.model("Submission", submissionSchema);
