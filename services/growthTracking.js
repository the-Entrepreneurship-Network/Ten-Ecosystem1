'use strict';

/**
 * Signed links for opens, clicks and unsubscribe.
 *
 * Every tracking URL carries an HMAC of the ids it contains, so:
 *
 *   - nobody can walk /g/u/<any student id> and unsubscribe the whole cohort
 *   - nobody can inflate a campaign's click count by guessing URLs
 *
 * The secret is SESSION_SECRET, which config/secrets.js already requires at
 * boot — no new secret to set, and nothing new to lose.
 *
 * The click route deliberately takes NO destination from the request. It reads
 * the target off the campaign. A `?url=` parameter would be an open redirect
 * on a domain students are being taught to trust.
 */

const crypto = require('crypto');
const { PORTAL_URL } = require('../utils/mailer');

const BASE = String(PORTAL_URL || '').replace(/\/+$/, '');

function secret() {
    return process.env.SESSION_SECRET || '';
}

function sign(kind, ...parts) {
    const key = secret();
    // Without a secret, signing would be a constant string that anyone could
    // reproduce. Return empty so verify() fails closed instead.
    if (!key) return '';
    return crypto.createHmac('sha256', key)
        .update([kind, ...parts.map(String)].join(':'))
        .digest('hex')
        .slice(0, 16);
}

function verify(sig, kind, ...parts) {
    const expected = sign(kind, ...parts);
    if (!expected || !sig || sig.length !== expected.length) return false;
    try {
        return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
    } catch (_) {
        return false;
    }
}

const openUrl        = (c, u) => `${BASE}/g/o/${c}/${u}/${sign('o', c, u)}.gif`;
const clickUrl       = (c, u) => `${BASE}/g/c/${c}/${u}/${sign('c', c, u)}`;
const unsubscribeUrl = (u)    => `${BASE}/g/u/${u}/${sign('u', u)}`;

/** A 1×1 transparent GIF — the smallest thing that can report an open. */
const PIXEL = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');

module.exports = { sign, verify, openUrl, clickUrl, unsubscribeUrl, PIXEL, BASE };
