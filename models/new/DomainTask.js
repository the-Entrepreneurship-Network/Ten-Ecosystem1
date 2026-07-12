// NEW FEATURE: Domain Task Library (all domains × all duration types)
const mongoose = require("mongoose");

const domainTaskSchema = new mongoose.Schema({
    domain:          { type: String, required: true, index: true },
    durationType:    { type: String, enum: ["45days", "1month", "3months", "6months"], required: true, index: true },
    weekNumber:      { type: Number, required: true },
    taskTitle:       { type: String, required: true },
    taskDescription: { type: String, required: true },
    videoUrl:        { type: String, default: null },
    fallbackVideoUrl:{ type: String, default: null },
    coinReward:      { type: Number, default: 10 },
    difficultyLevel: { type: String, enum: ["easy", "medium", "hard", "expert"], default: "easy" }
}, { timestamps: true });

domainTaskSchema.index({ domain: 1, durationType: 1, weekNumber: 1 }, { unique: true });

module.exports = mongoose.model("DomainTask", domainTaskSchema);
