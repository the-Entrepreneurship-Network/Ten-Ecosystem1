const mongoose = require("mongoose");

/**
 * A student's daily job-post task: share the opening on N platforms, earn coins.
 *
 * public/v2-tasks.html posted this to /api/v2/student/daily-job-post — an
 * endpoint that does not exist anywhere in the codebase. The fetch rejected,
 * `.catch(() => ({ success: true }))` swallowed it, the page wrote the result
 * to localStorage under `djp_<employeeId>` and congratulated the student on
 * coins they never received. Clearing browser storage reset the task; the
 * server never knew either way.
 *
 * The unique index is the point: one submission per student per day, enforced
 * where it cannot be cleared from a browser console.
 */
const dailyJobPostSchema = new mongoose.Schema({
    studentId:  { type: mongoose.Schema.Types.ObjectId, ref: "Student", required: true, index: true },
    employeeId: { type: String, required: true, index: true },

    // Stored as YYYY-MM-DD in the portal's timezone rather than a Date, because
    // "one per day" is a calendar-day question and a timestamp makes that a
    // range query with a timezone bug waiting in it.
    date: { type: String, required: true, index: true },

    platforms:  { type: [String], default: [] },
    coins:      { type: Number, default: 0, min: 0 },

    // Awarded coins are credited through coinService; this records what was
    // actually granted, which may differ from what the client asked for.
    coinsAwarded: { type: Number, default: 0, min: 0 },

    submittedAt: { type: Date, default: Date.now }
}, { timestamps: true });

dailyJobPostSchema.index({ studentId: 1, date: 1 }, { unique: true });

module.exports = mongoose.model("DailyJobPost", dailyJobPostSchema);
