// NEW FEATURE: Student Streak & Daily Login Tracking
const mongoose = require("mongoose");

const studentStreakSchema = new mongoose.Schema({
    studentId:      { type: mongoose.Schema.Types.ObjectId, ref: "Student", required: true, unique: true },
    currentStreak:  { type: Number, default: 0 },
    longestStreak:  { type: Number, default: 0 },
    lastLoginDate:  { type: String, default: null },
    freezesOwned:   { type: Number, default: 0 },
    freezesUsed:    { type: Number, default: 0 },
    // Array of "YYYY-MM-DD" strings for streak calendar
    loginDates:     { type: [String], default: [] }
}, { timestamps: true });

studentStreakSchema.index({ studentId: 1 });

module.exports = mongoose.model("StudentStreak", studentStreakSchema);
