'use strict';

const mongoose = require('mongoose');

/**
 * One sitting of one exam — a topic test or the two-hour final.
 *
 * The questions AND the answer key live here, server-side, written when the
 * attempt starts. The client is sent the questions without the key, which is
 * the only arrangement under which an MCQ means anything. A fresh attempt gets
 * freshly generated questions, which is what makes a retake a retake.
 */
const QuestionSchema = new mongoose.Schema({
    kind:     { type: String, enum: ['written', 'mcq'], required: true },
    prompt:   { type: String, required: true },
    options:  { type: [String], default: undefined },  // mcq only
    answerIndex: { type: Number, default: null },      // mcq only — never sent to the client
    // filled at submit
    givenAnswer: { type: mongoose.Schema.Types.Mixed, default: null },
    correct:     { type: Boolean, default: null },
    feedback:    { type: String, default: '' }
}, { _id: false });

const LearnExamAttemptSchema = new mongoose.Schema({
    userId:     { type: mongoose.Schema.Types.ObjectId, ref: 'EcosystemUser', required: true, index: true },
    domainSlug: { type: String, required: true },
    // topic number, or 0 for the final exam
    topicN:     { type: Number, required: true },
    questions:  { type: [QuestionSchema], default: [] },
    startedAt:  { type: Date, default: Date.now },
    // The clock is the server's. A submit after this moment grades what was
    // given and nothing else; the browser's timer is only a courtesy display.
    deadlineAt: { type: Date, required: true },
    submittedAt:{ type: Date, default: null },
    warningCount: { type: Number, default: 0 },
    // 3 warnings: the attempt is void and an incident goes to HR.
    voidedAt:   { type: Date, default: null },
    writtenScore: { type: Number, default: null },
    mcqScore:     { type: Number, default: null },
    passed:       { type: Boolean, default: null }
}, { timestamps: true });

LearnExamAttemptSchema.index({ userId: 1, domainSlug: 1, topicN: 1, createdAt: -1 });

module.exports = mongoose.models.LearnExamAttempt || mongoose.model('LearnExamAttempt', LearnExamAttemptSchema);
