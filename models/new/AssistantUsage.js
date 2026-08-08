// NEW FEATURE: TEN Assistant entitlement + message quota
const mongoose = require('mongoose');

/*
 * Server-side record of what a student has paid for and how much they have
 * used this period.
 *
 * This lives in the database rather than in browser storage on purpose. A
 * counter kept on the client is cleared by one devtools command or an app
 * reinstall, so anything gated on it is not really gated. Since these limits
 * decide who has paid, the authoritative count has to sit somewhere the
 * student cannot edit.
 */
const assistantUsageSchema = new mongoose.Schema({
  userId: { type: String, required: true, unique: true, index: true },

  tier: {
    type: String,
    enum: ['starter', 'pro', 'plus', 'enterprise'],
    default: 'starter',
  },

  // Messages consumed in the current period, and when that period began.
  messagesUsed:  { type: Number, default: 0 },
  periodStart:   { type: Date,   default: Date.now },

  // Entitlement, as reported by whichever billing system granted it.
  entitlement: {
    productId:  { type: String, default: null },
    store:      { type: String, default: null },  // revenuecat | setu | manual
    expiresAt:  { type: Date,   default: null },
    grantedAt:  { type: Date,   default: null },
    // RevenueCat's stable customer id, so a webhook can find this row.
    appUserId:  { type: String, default: null, index: true },
  },

  // Retained per tier: 7 days on Pro, 30 on Plus, unbounded on Enterprise.
  // Starter keeps nothing, which is why history is trimmed on write.
  history: [{
    _id:      false,
    question: String,
    answer:   String,
    askedAt:  { type: Date, default: Date.now },
  }],
}, { timestamps: true });

module.exports = mongoose.model('AssistantUsage', assistantUsageSchema);
