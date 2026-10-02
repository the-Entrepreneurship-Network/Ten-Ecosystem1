'use strict';

const mongoose = require('mongoose');

/**
 * A DAO proposal, with its votes stored inside it.
 *
 * The votes are embedded rather than given their own collection for one
 * reason: one-student-one-vote then costs a single atomic update —
 *
 *   updateOne({ _id, status: 'open', 'votes.studentId': { $ne: id } },
 *             { $push: { votes: ... } })
 *
 * — which cannot double-count under concurrency, because the duplicate check
 * and the insert are the same operation. A separate collection would need a
 * unique compound index plus a caught duplicate-key error to say the same
 * thing in more code. At a few hundred voters a proposal document stays four
 * orders of magnitude inside the 16MB limit.
 */

const voteSchema = new mongoose.Schema({
    studentId:  { type: mongoose.Schema.Types.ObjectId, ref: 'Student', required: true },
    employeeId: { type: String, default: '' },
    name:       { type: String, default: '' },
    choice:     { type: String, enum: ['for', 'against', 'abstain'], required: true },
    /**
     * Voice at the moment the vote was cast — sqrt(balance), per config/daoConfig.js.
     *
     * Snapshotted, not computed at close time, because a balance moves. A
     * student who earned coins after voting would otherwise retroactively gain
     * voice on a vote they already cast, and one who spent coins on a
     * mentorship session would be quietly punished for it.
     */
    weight:      { type: Number, required: true, min: 0 },
    /** The balance that weight came from, kept so any tally can be re-derived. */
    coinsAtVote: { type: Number, required: true, min: 0 },
    at:          { type: Date, default: Date.now }
}, { _id: false });

const daoProposalSchema = new mongoose.Schema({
    title: { type: String, required: true, trim: true, maxlength: 140 },
    body:  { type: String, required: true, trim: true, maxlength: 4000 },

    authorStudentId:  { type: mongoose.Schema.Types.ObjectId, ref: 'Student', required: true },
    authorEmployeeId: { type: String, default: '' },
    authorName:       { type: String, default: 'Student' },

    status: {
        type: String,
        enum: ['open', 'passed', 'rejected', 'cancelled'],
        default: 'open',
        index: true
    },

    /** Coins staked to raise this. Already debited when the row exists. */
    depositCoins:    { type: Number, default: 0, min: 0 },
    /** Set with the close, in the same atomic update, so it refunds once. */
    depositSettled:  { type: Boolean, default: false },
    depositRefunded: { type: Boolean, default: false },

    closesAt: { type: Date, required: true },
    closedAt: { type: Date, default: null },
    /** The sentence shown to students for why it went the way it did. */
    outcomeReason: { type: String, default: '' },

    votes: { type: [voteSchema], default: [] }
}, { timestamps: true });

// The list screen's query: what is open, soonest to close first.
daoProposalSchema.index({ status: 1, closesAt: 1 });

module.exports = mongoose.models.DaoProposal
    || mongoose.model('DaoProposal', daoProposalSchema);
