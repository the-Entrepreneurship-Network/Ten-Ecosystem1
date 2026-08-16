// NEW FEATURE: Coordinator Coin Balance & Performance Tracking
const mongoose = require("mongoose");

const coinHistoryEntrySchema = new mongoose.Schema({
    action:    { type: String, required: true },
    coins:     { type: Number, required: true },
    timestamp: { type: Date, default: Date.now }
}, { _id: false });

const coordinatorCoinSchema = new mongoose.Schema({
    coordinatorId:        { type: String, required: true, unique: true },
    totalCoins:           { type: Number, default: 0 },
    coinsHistory:         { type: [coinHistoryEntrySchema], default: [] },
    performanceScore:     { type: Number, default: 0.00 },
    avgReviewTimeHours:   { type: Number, default: 0.00 },
    totalTasksReviewed:   { type: Number, default: 0 },
    lastUpdated:          { type: Date, default: Date.now }
}, { timestamps: true });

coordinatorCoinSchema.index({ coordinatorId: 1 });
coordinatorCoinSchema.index({ performanceScore: -1 });

module.exports = mongoose.model("CoordinatorCoin", coordinatorCoinSchema);
