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
    store:      { type: String, default: null },  // upi | setu | manual
    expiresAt:  { type: Date,   default: null },
    grantedAt:  { type: Date,   default: null },
    // Stable id for whichever billing system granted this, so a later
    // callback can find the row again.
    appUserId:  { type: String, default: null, index: true },
  },

  /*
   * A submitted UPI reference, awaiting human verification.
   *
   * Kept separate from `entitlement` on purpose: this is a claim, not a
   * grant. A static UPI QR reports nothing back to this server, so the only
   * thing a submission proves is that the student typed something.
   */
  pendingPayment: {
    tier:        { type: String, default: null },
    amount:      { type: Number, default: null },
    utr:         { type: String, default: null },
    status:      { type: String, enum: ['pending', 'verified', 'rejected'], default: null },
    submittedAt: { type: Date,   default: null },
    reviewedBy:  { type: String, default: null },
    reviewedAt:  { type: Date,   default: null },
    note:        { type: String, default: null },
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
