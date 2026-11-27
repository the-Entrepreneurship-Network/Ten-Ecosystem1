'use strict';

const mongoose = require('mongoose');

/**
 * What a student last hunted for, so new openings that fit can reach them.
 *
 * Saved by every Job Portal search. The daily alert compares the collector's
 * newest openings with this profile and tells the student's phone about the
 * ones they have not been told about (`seen`). Email is a weekly digest, and
 * only for a student who asked for it: the Monday mail already uses most of
 * the month's marketing allowance.
 */
const schema = new mongoose.Schema({
    subject: { type: String, required: true, unique: true },
    employeeId: { type: String, default: '' },
    profile: {
        role: String, seniority: String, location: String, skills: [String], years: Number,
    },
    alerts: { type: Boolean, default: true },
    weeklyEmail: { type: Boolean, default: false },
    seen: [String],                                      // opening keys already announced, newest last
    lastAlertAt: Date,
    lastEmailAt: Date,
}, { timestamps: true, versionKey: false });

module.exports = mongoose.models.JobAlert || mongoose.model('JobAlert', schema);
