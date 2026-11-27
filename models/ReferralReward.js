const mongoose = require('mongoose');

/**
 * One reward a referral earned. services/referrals.js writes these; nothing
 * else should.
 *
 *   week1_coins  the friend finished their first week: coins for both
 *   paid_coins   the friend's first approved payment: coins for both
 *   commission   a share of one approved payment, for the referrer only
 *
 * `key` makes each reward happen once however often, or however concurrently,
 * the settle runs: week1:<friend>, paid:<friend>, commission:<payment>.
 *
 * A commission is pending until `availableAt` (15 days after the payment) and
 * available after it. It is reversed, not deleted, when its payment stops
 * being an approved payment (a refund, for example).
 */
const referralRewardSchema = new mongoose.Schema({
    key:         { type: String, required: true, unique: true },
    kind:        { type: String, enum: ['week1_coins', 'paid_coins', 'commission'], required: true },
    referrerId:  { type: mongoose.Schema.Types.ObjectId, ref: 'Student', required: true },
    friendId:    { type: mongoose.Schema.Types.ObjectId, ref: 'Student', required: true },
    paymentId:   { type: mongoose.Schema.Types.ObjectId, ref: 'Payment', default: null },

    // Coin rewards: what each of the two students gets, and whether both
    // awards are made (a failed award is retried on the next settle).
    coins:       { type: Number, default: 0 },
    coinsDone:   { type: Boolean, default: false },

    // Commission, in rupees.
    base:        { type: Number, default: 0 },
    rate:        { type: Number, default: 0 },
    amount:      { type: Number, default: 0 },
    paidAt:      { type: Date, default: null },
    availableAt: { type: Date, default: null },

    status:      { type: String, enum: ['active', 'reversed'], default: 'active' },
    reversedAt:  { type: Date, default: null }
}, { timestamps: true });

referralRewardSchema.index({ referrerId: 1, kind: 1 });
referralRewardSchema.index({ friendId: 1 });

module.exports = mongoose.model('ReferralReward', referralRewardSchema);
