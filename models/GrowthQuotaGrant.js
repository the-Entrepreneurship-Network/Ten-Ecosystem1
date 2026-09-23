'use strict';

const mongoose = require('mongoose');

/**
 * An admin unlocking extra marketing allowance for one period.
 *
 * Kept as rows rather than a single mutable number so the audit trail survives:
 * who unlocked how much, when, and why. Several grants in one period add up,
 * and services/growthQuota.js is what refuses to let the total pass
 * EXTENSION_MAX.
 */
const GrowthQuotaGrantSchema = new mongoose.Schema({
    // "2026-09" — the period this grant applies to. A grant never carries over.
    periodKey: { type: String, required: true, index: true },
    amount:    { type: Number, required: true, min: 1 },
    grantedBy: { type: String, default: '' },
    reason:    { type: String, default: '' }
}, { timestamps: true });

module.exports = mongoose.models.GrowthQuotaGrant
    || mongoose.model('GrowthQuotaGrant', GrowthQuotaGrantSchema);
