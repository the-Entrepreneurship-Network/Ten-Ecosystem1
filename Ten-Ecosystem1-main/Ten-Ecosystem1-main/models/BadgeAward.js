const mongoose = require("mongoose");

// One row per (student, badge). Used by the auto-award logic in server.js
// (function awardBadgeIfNew). The badge catalog itself lives in BADGE_CATALOG
// in server.js so it can be imported by both the API layer and the auto-checks
// without an extra DB collection.

const badgeAwardSchema = new mongoose.Schema({
    studentId:  { type: mongoose.Schema.Types.ObjectId, ref: "Student", index: true },
    employeeId: { type: String, required: true, index: true },
    badgeId:    { type: String, required: true },     // matches a key in BADGE_CATALOG
    badgeName:  { type: String, required: true },
    badgeIcon:  { type: String, required: true },
    awardedAt:  { type: Date, default: Date.now }
});

// One award per (student, badge).
badgeAwardSchema.index({ employeeId: 1, badgeId: 1 }, { unique: true });

module.exports = mongoose.model("BadgeAward", badgeAwardSchema);
