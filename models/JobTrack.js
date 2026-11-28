'use strict';

const mongoose = require('mongoose');

/**
 * One opening in a student's application tracker: found, tailored, emailed,
 * applied, interview, offer or closed. It was kept in each browser's
 * localStorage, so a phone and a laptop had two trackers and a new browser
 * none; it is the student's now, on the server, in both portals.
 *
 * `appliedAt` starts the follow-up clock: the agent drafts a day-4 and a
 * day-10 follow-up with every application, and the student is reminded when
 * one is due (`nudged`) until they mark it sent (`followUpsSent`).
 */
const schema = new mongoose.Schema({
    subject: { type: String, required: true },           // the student or learner
    employeeId: { type: String, default: '' },           // for the phone reminder; learners have none
    url: { type: String, required: true },
    company: { type: String, default: '' },
    role: { type: String, default: '' },
    fit: { type: Number, default: 0 },
    status: { type: String, default: 'found', enum: ['found', 'tailored', 'emailed', 'applied', 'interview', 'offer', 'closed'] },
    notes: { type: String, default: '' },
    to: { type: String, default: '' },                   // the recruiter's published address, if any
    followUps: [{ afterDays: Number, subject: String, body: String, _id: false }],
    appliedAt: Date,
    followUpsSent: [Number],
    nudged: [Number],
}, { timestamps: true, versionKey: false });

schema.index({ subject: 1, url: 1 }, { unique: true });
schema.index({ status: 1, appliedAt: 1 });

module.exports = mongoose.models.JobTrack || mongoose.model('JobTrack', schema);
