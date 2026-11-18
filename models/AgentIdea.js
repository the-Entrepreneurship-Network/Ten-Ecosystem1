'use strict';

const mongoose = require('mongoose');

/**
 * One proposal from the idea agent.
 *
 * The agent runs on a schedule and writes rows here. It does not act on them.
 * A proposal arrives as `pending_review` and only a person moves it on, which
 * is the same shape the fee payments use (`pending_verification` → a human
 * approves) and is deliberate: an unattended model that could publish under
 * TEN's name is a liability, not a feature. Nothing in this file, and nothing
 * in services/ideaAgent.js, builds or deploys anything.
 *
 * `runId` groups the proposals from a single scheduled run, so a bad run can
 * be read — and dismissed — as one batch.
 */
const agentIdeaSchema = new mongoose.Schema({
    runId:      { type: String, required: true, index: true },

    title:      { type: String, required: true },
    summary:    { type: String, required: true },
    forWhom:    { type: String, default: '' },
    whyNow:     { type: String, default: '' },
    // The agent's own estimate, not a commitment: 'small' | 'medium' | 'large'.
    effort:     { type: String, default: 'medium' },

    status: {
        type: String,
        enum: ['pending_review', 'approved', 'rejected'],
        default: 'pending_review',
        index: true
    },
    reviewedBy:      { type: String, default: null },
    reviewedAt:      { type: Date,   default: null },
    rejectionReason: { type: String, default: null },

    // Which model produced it, so a change in output quality can be traced to
    // a model change rather than guessed at.
    model:      { type: String, default: '' },

    createdAt:  { type: Date, default: Date.now, index: true }
});

module.exports = mongoose.models.AgentIdea
    || mongoose.model('AgentIdea', agentIdeaSchema);
