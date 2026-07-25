// NEW FEATURE: Leaderboard Cache (updated every 30 minutes by cron job)
const mongoose = require("mongoose");

const leaderboardCacheSchema = new mongoose.Schema({
    studentId:      { type: mongoose.Schema.Types.ObjectId, ref: "Student", required: true },
    domain:         { type: String, required: true },
    cohortId:       { type: String, default: null },
    totalCoins:     { type: Number, default: 0 },
    tasksCompleted: { type: Number, default: 0 },
    streakDays:     { type: Number, default: 0 },
    globalRank:     { type: Number, default: null },
    domainRank:     { type: Number, default: null },
    cohortRank:     { type: Number, default: null },
    updatedAt:      { type: Date, default: Date.now }
}, { timestamps: true });

leaderboardCacheSchema.index({ studentId: 1, domain: 1 }, { unique: true });
leaderboardCacheSchema.index({ totalCoins: -1 });
leaderboardCacheSchema.index({ domain: 1, totalCoins: -1 });
leaderboardCacheSchema.index({ cohortId: 1, totalCoins: -1 });

module.exports = mongoose.model("LeaderboardCache", leaderboardCacheSchema);
