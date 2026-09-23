'use strict';

/**
 * Who a campaign can go to.
 *
 * Every segment is a Mongo query, so the dashboard can show a live count
 * ("Dormant 14+ days: 1,470") before anyone presses Send — you should never
 * have to guess how many people a campaign reaches.
 *
 * Two filters are applied to EVERY segment and cannot be turned off:
 *
 *   emailOptOut: someone who unsubscribed is never mailed again. This is the
 *   filter that keeps the sending domain alive; the account has already been
 *   suspended once for sending behaviour.
 *
 *   a usable address: a row with no email, or "x@example.com", is a bounce,
 *   and bounces are counted against the domain by every mailbox provider.
 */

const Student = require('../models/Student');
const { PAID_TENURES } = require('../config/tenurePayment');

const daysAgo = (n) => new Date(Date.now() - n * 24 * 60 * 60 * 1000);

/** Tenure keys that carry a programme fee, and those that do not. */
const PAID_KEYS = Object.keys(PAID_TENURES);

/** Applied on top of every segment. Never optional. */
function baseFilter() {
    return {
        emailOptOut: { $ne: true },
        email: { $exists: true, $nin: [null, ''] }
    };
}

const SEGMENTS = {
    all: {
        label: 'Everyone',
        description: 'Every student with a usable address who has not unsubscribed.',
        query: () => ({})
    },
    dormant14: {
        label: 'Dormant — 14+ days',
        description: 'Not active for two weeks, or never active. The re-engagement audience.',
        query: () => ({ $or: [{ lastActiveDate: { $lt: daysAgo(14) } }, { lastActiveDate: null }, { lastActiveDate: { $exists: false } }] })
    },
    active7: {
        label: 'Active — last 7 days',
        description: 'Opened the portal this week. The warmest audience for an upsell.',
        query: () => ({ lastActiveDate: { $gte: daysAgo(7) } })
    },
    freeTenure: {
        label: 'On a free track',
        description: '45 Days / 3 Months / 6 Months — no programme fee paid, so the Studio upsell is the offer.',
        query: () => ({ tenure: { $nin: PAID_KEYS } })
    },
    paidTenure: {
        label: 'On a paid track',
        description: '1 Week / 15 Days / 1 Month — already paying, so they already have the Studio.',
        query: () => ({ tenure: { $in: PAID_KEYS } })
    }
};

function isSegment(key) {
    return Object.prototype.hasOwnProperty.call(SEGMENTS, key);
}

function filterFor(key) {
    if (!isSegment(key)) throw new Error(`Unknown segment: ${key}`);
    return { ...baseFilter(), ...SEGMENTS[key].query() };
}

async function countFor(key) {
    return Student.countDocuments(filterFor(key));
}

/** Every segment with its live count — one call, for the dashboard picker. */
async function listWithCounts() {
    const keys = Object.keys(SEGMENTS);
    const counts = await Promise.all(keys.map((k) => countFor(k).catch(() => null)));
    return keys.map((key, i) => ({
        key,
        label: SEGMENTS[key].label,
        description: SEGMENTS[key].description,
        count: counts[i]
    }));
}

/**
 * The recipients themselves.
 *
 * Deduplicated by address, because Student holds one ROW PER DOMAIN — a
 * student on two domains is two rows under one address, and mailing rows
 * rather than people is what sent the same mail twice every Monday before.
 */
async function recipientsFor(key, limit = 20000) {
    const rows = await Student.find(filterFor(key))
        .select('_id name firstName lastName email employeeId')
        .limit(limit)
        .lean();
    const seen = new Set();
    const out = [];
    for (const r of rows) {
        const addr = String(r.email || '').trim().toLowerCase();
        if (!addr || seen.has(addr)) continue;
        seen.add(addr);
        out.push(r);
    }
    return out;
}

module.exports = { SEGMENTS, isSegment, filterFor, countFor, listWithCounts, recipientsFor, baseFilter };
