'use strict';

const mongoose = require('mongoose');

/**
 * A learner crossed the three-warning line during a proctored exam.
 *
 * The exam is locked the moment this exists with status 'pending', and only an
 * HR decision reopens it. Approve → the learner may sit that exam again.
 * Reject → that topic's exam is closed for good and the journey continues at
 * the next topic. Either way the decision, who made it and what was said to
 * the learner are all kept here.
 */
const ProctorIncidentSchema = new mongoose.Schema({
    userId:     { type: mongoose.Schema.Types.ObjectId, ref: 'EcosystemUser', required: true, index: true },
    learnerName:  { type: String, default: '' },
    learnerEmail: { type: String, default: '' },
    domainSlug: { type: String, required: true },
    topicN:     { type: Number, required: true },   // 0 = final exam
    attemptId:  { type: mongoose.Schema.Types.ObjectId, ref: 'LearnExamAttempt' },
    // What the proctor saw, one entry per warning.
    warnings:   { type: [{ at: Date, reason: String }], default: [] },
    status:     { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending', index: true },
    hrNote:     { type: String, default: '' },
    decidedBy:  { type: String, default: '' },
    decidedAt:  { type: Date, default: null }
}, { timestamps: true });

module.exports = mongoose.models.ProctorIncident || mongoose.model('ProctorIncident', ProctorIncidentSchema);
