// NEW FEATURE: Student Cohort Definitions
const mongoose = require("mongoose");

const cohortSchema = new mongoose.Schema({
    cohortName:    { type: String, required: true },
    domain:        { type: String, required: true },
    startDate:     { type: Date, default: null },
    endDate:       { type: Date, default: null },
    coordinatorId: { type: String, default: null }
}, { timestamps: true });

cohortSchema.index({ domain: 1 });

module.exports = mongoose.model("Cohort", cohortSchema);
