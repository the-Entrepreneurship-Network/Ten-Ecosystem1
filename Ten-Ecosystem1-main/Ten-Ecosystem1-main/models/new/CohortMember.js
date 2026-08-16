// NEW FEATURE: Cohort Member Assignments
const mongoose = require("mongoose");

const cohortMemberSchema = new mongoose.Schema({
    cohortId:  { type: mongoose.Schema.Types.ObjectId, ref: "Cohort", required: true },
    studentId: { type: mongoose.Schema.Types.ObjectId, ref: "Student", required: true },
    joinedAt:  { type: Date, default: Date.now }
}, { timestamps: true });

cohortMemberSchema.index({ cohortId: 1, studentId: 1 }, { unique: true });
cohortMemberSchema.index({ studentId: 1 });

module.exports = mongoose.model("CohortMember", cohortMemberSchema);
