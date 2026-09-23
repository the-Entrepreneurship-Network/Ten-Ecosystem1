'use strict';

/**
 * How much marketing mail is left this period, and who may unlock more.
 *
 * There is deliberately NO counter document. The count is a query over
 * MailHistory, which already gets a row for every mail the portal sends:
 *
 *   - it cannot drift out of sync with reality, because it IS reality
 *   - it is already true for periods before this feature existed
 *   - a crash mid-campaign loses nothing; the rows written so far still count
 *
 * `sentAt` is indexed, and a period holds ~12k rows, so the count is cheap.
 */

const MailHistory = require('../models/MailHistory');
const GrowthQuotaGrant = require('../models/GrowthQuotaGrant');
const Q = require('../config/growthQuota');

/**
 * Marketing mail already sent in the period containing `now`.
 *
 * Counts failures as well as successes. A row with status "failed" may still
 * have been ACCEPTED by the provider before bouncing downstream, and the
 * provider bills its allowance on acceptance. Over-counting costs a few
 * unsent mails; under-counting costs a suspended account, which stops
 * certificates too.
 */
async function usedThisPeriod(now = new Date()) {
    return MailHistory.countDocuments({
        sentAt: { $gte: Q.periodStart(now), $lt: Q.periodEnd(now) },
        mailType: { $in: Q.MARKETING_TYPES }
    });
}

/** Extra allowance unlocked by an admin for this period, capped at EXTENSION_MAX. */
async function grantedThisPeriod(now = new Date()) {
    const rows = await GrowthQuotaGrant.aggregate([
        { $match: { periodKey: Q.periodKey(now) } },
        { $group: { _id: null, total: { $sum: '$amount' } } }
    ]);
    const total = (rows[0] && rows[0].total) || 0;
    return Math.min(total, Q.EXTENSION_MAX);
}

/** Everything the dashboard needs to draw the meter, in one call. */
async function usage(now = new Date()) {
    const [used, granted] = await Promise.all([usedThisPeriod(now), grantedThisPeriod(now)]);
    const limit = Q.STAGE1_LIMIT + granted;
    return {
        periodKey:     Q.periodKey(now),
        periodStart:   Q.periodStart(now),
        periodEnd:     Q.periodEnd(now),
        used,
        stage1:        Q.STAGE1_LIMIT,
        granted,
        limit,
        remaining:     Math.max(0, limit - used),
        // What a further grant could still unlock, so the popup can say
        // "up to 2,500 more" rather than always offering the full 4,000.
        grantable:     Math.max(0, Q.EXTENSION_MAX - granted),
        ceiling:       Q.MARKETING_CEILING,
        portalReserve: Q.PORTAL_RESERVE,
        providerCap:   Q.PROVIDER_MONTHLY_CAP,
        // True once stage 1 is spent and an extension is the only way forward.
        needsExtension: used >= limit && granted < Q.EXTENSION_MAX,
        // True when even an extension cannot help: the period is finished.
        exhausted:      used >= Q.STAGE1_LIMIT + Q.EXTENSION_MAX
    };
}

/**
 * Unlock more allowance for this period.
 *
 * Refuses anything that would take the period past EXTENSION_MAX, so the
 * 11,500 ceiling holds no matter how many times the button is pressed.
 */
async function grantExtension({ amount, grantedBy = '', reason = '' }, now = new Date()) {
    const want = Math.floor(Number(amount));
    if (!Number.isFinite(want) || want < 1) {
        return { ok: false, error: 'Amount must be a positive number of emails.' };
    }
    const granted = await grantedThisPeriod(now);
    const grantable = Q.EXTENSION_MAX - granted;
    if (grantable <= 0) {
        return { ok: false, error: `The full ${Q.EXTENSION_MAX} extension for this period is already unlocked.` };
    }
    if (want > grantable) {
        return { ok: false, error: `Only ${grantable} more can be unlocked this period.` };
    }
    await GrowthQuotaGrant.create({
        periodKey: Q.periodKey(now),
        amount: want,
        grantedBy: String(grantedBy || '').slice(0, 120),
        reason: String(reason || '').slice(0, 400)
    });
    return { ok: true, usage: await usage(now) };
}

/**
 * Whether `count` more marketing mails fit right now.
 *
 * ponytail: this reads the count rather than reserving it, so a campaign and
 * the Monday cron running in the same minute can together overshoot by at most
 * the size of one batch. The cost of that is a few extra mails against a
 * 3,500-mail reserve; the cost of a reservation table is a second source of
 * truth that can leak rows when a send crashes. Revisit only if two people
 * ever send large campaigns simultaneously.
 */
async function canSend(count = 1, now = new Date()) {
    const u = await usage(now);
    return { allowed: u.remaining >= count, remaining: u.remaining, usage: u };
}

module.exports = { usage, usedThisPeriod, grantedThisPeriod, grantExtension, canSend };
