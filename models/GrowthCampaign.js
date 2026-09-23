'use strict';

const mongoose = require('mongoose');

/**
 * One campaign: what was written, who it went to, and what came back.
 *
 * The last three counters are the reason this collection exists. Sender.net
 * can already tell you a campaign was opened; what it cannot tell you is that
 * the person who opened it then paid ₹500, because it has never heard of the
 * Payment collection. `clickedStudentIds` is the join key that makes
 * "this campaign earned ₹X" answerable.
 */
const GrowthCampaignSchema = new mongoose.Schema({
    name:      { type: String, required: true, trim: true },
    subject:   { type: String, required: true, trim: true },
    heading:   { type: String, default: '' },
    bodyText:  { type: String, default: '' },      // plain text; rendered through renderEmail
    ctaLabel:  { type: String, default: '' },
    ctaUrl:    { type: String, default: '' },
    segment:   { type: String, required: true },

    status: {
        type: String,
        enum: ['draft', 'sending', 'sent', 'stopped', 'failed'],
        default: 'draft',
        index: true
    },

    recipientCount: { type: Number, default: 0 },   // how many the segment matched at send time
    sentCount:      { type: Number, default: 0 },
    failedCount:    { type: Number, default: 0 },
    // Recipients the quota would not cover. Never silently dropped: this is
    // the number the dashboard shows as "N not sent — quota exhausted".
    skippedCount:   { type: Number, default: 0 },

    openedStudentIds:  [{ type: mongoose.Schema.Types.ObjectId, ref: 'Student' }],
    clickedStudentIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Student' }],

    createdBy: { type: String, default: '' },
    startedAt: { type: Date, default: null },
    sentAt:    { type: Date, default: null },
    error:     { type: String, default: '' }
}, { timestamps: true });

GrowthCampaignSchema.index({ createdAt: -1 });

module.exports = mongoose.models.GrowthCampaign
    || mongoose.model('GrowthCampaign', GrowthCampaignSchema);
