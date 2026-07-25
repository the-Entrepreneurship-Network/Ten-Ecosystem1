// NEW FEATURE: Referral Tracking
const mongoose = require("mongoose");

const referralSchema = new mongoose.Schema({
    referrerId:      { type: mongoose.Schema.Types.ObjectId, ref: "Student", required: true },
    referredEmail:   { type: String, lowercase: true, trim: true, required: true },
    referredUserId:  { type: mongoose.Schema.Types.ObjectId, ref: "Student", default: null },
    status:          { type: String, enum: ["pending", "registered", "first_task_done"], default: "pending" },
    coinsAwarded:    { type: Number, default: 0 }
}, { timestamps: true });

// Prevent duplicate referrals silently — unique on referrerId + referredEmail
referralSchema.index({ referrerId: 1, referredEmail: 1 }, { unique: true });
referralSchema.index({ referrerId: 1 });

module.exports = mongoose.model("Referral", referralSchema);
