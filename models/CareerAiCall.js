'use strict';

const mongoose = require('mongoose');

/**
 * One Gemini answer for the Career Studio agents (job match, rewording).
 *
 * Two jobs in one collection: the cache — the same question is never paid for
 * twice — and the usage log, since every row is one call. The daily limits
 * count today's rows. Gemini's free quota is shared with the exams and the AI
 * Coordinator, which must not be the ones to run out. Rows expire after 30 days.
 */
const schema = new mongoose.Schema({
    key: { type: String, required: true, unique: true }, // sha256 of the kind and the input
    kind: { type: String, required: true },
    subject: { type: String, default: '' },              // the student or learner who asked
    result: mongoose.Schema.Types.Mixed,
    createdAt: { type: Date, default: Date.now, expires: 30 * 86400 },
}, { versionKey: false });

schema.index({ subject: 1, createdAt: -1 });

module.exports = mongoose.models.CareerAiCall || mongoose.model('CareerAiCall', schema);
