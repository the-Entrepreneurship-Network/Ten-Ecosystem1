'use strict';

const mongoose = require('mongoose');

/**
 * One learner's journey through one domain of the LLM portal.
 *
 * Progress is per (user, domain) — a learner who buys the Studio can walk any
 * domain, and each walk is its own document rather than a growing map on the
 * user. The topic list itself lives in data/learn/*.json; this stores only
 * what happened, so editing the curriculum never migrates anybody.
 */
const TopicStateSchema = new mongoose.Schema({
    n:            { type: Number, required: true },   // 1-based topic number
    readAt:       { type: Date, default: null },
    videoDoneAt:  { type: Date, default: null },
    passedAt:     { type: Date, default: null },
    attempts:     { type: Number, default: 0 },
    // An HR rejection after three proctor warnings: the topic's exam is closed
    // for good and the learner moves on to the next topic without it.
    closedByHRAt: { type: Date, default: null }
}, { _id: false });

const LearnProgressSchema = new mongoose.Schema({
    userId:     { type: mongoose.Schema.Types.ObjectId, ref: 'EcosystemUser', required: true, index: true },
    domainSlug: { type: String, required: true, index: true },
    topics:     { type: [TopicStateSchema], default: [] },
    finalExam: {
        passedAt: { type: Date, default: null },
        attempts: { type: Number, default: 0 },
        closedByHRAt: { type: Date, default: null }
    },
    project: {
        url:       { type: String, default: '' },
        note:      { type: String, default: '' },
        doneAt:    { type: Date, default: null },
        skippedAt: { type: Date, default: null }
    },
    certificateId: { type: String, default: null, index: true },
    certIssuedAt:  { type: Date, default: null }
}, { timestamps: true });

LearnProgressSchema.index({ userId: 1, domainSlug: 1 }, { unique: true });

module.exports = mongoose.models.LearnProgress || mongoose.model('LearnProgress', LearnProgressSchema);
