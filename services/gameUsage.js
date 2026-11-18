'use strict';

/**
 * What the Business Playground is being used for, read from the game.
 *
 * The game is a Cloudflare Worker with its own database. It shares no users
 * with this portal — a school teacher has no account here, a college intern
 * has none there — so this is not a sign-in bridge and carries no identity.
 * It is one server asking another for counts.
 *
 * The key never leaves this process. The browser asks the portal, the portal
 * asks the game; putting the key in the admin page would publish it to
 * everyone who opens that page.
 *
 * Everything here fails soft. A school-usage panel is the least important
 * thing in the admin, and the game being unreachable must never be able to
 * take an admin screen down with it.
 */

const { httpFetch } = require('./v2/httpFetch');

/** Where the game lives. Set GAME_BASE_URL when the subdomain lands. */
const BASE_URL = () =>
    (process.env.GAME_BASE_URL || 'https://ten-biz-game.tenetwork.workers.dev')
        .replace(/\/+$/, '');

const KEY = () => process.env.GAME_USAGE_KEY || '';

/**
 * Long enough for a cold Worker, short enough that an admin page does not
 * appear to hang. The panel renders its error state instead.
 */
const TIMEOUT_MS = 8000;

/** Is this configured at all? Nothing is attempted without a key. */
function configured() {
    return KEY().length >= 8;
}

/**
 * Fetch the usage summary.
 *
 * Resolves to `{ ok: false, reason }` rather than throwing. Every caller is a
 * route handler rendering a panel, and there is no outcome here worth a 500:
 * the portal works perfectly well while the game is unreachable.
 *
 * @returns {Promise<{ok: boolean, reason?: string, schools?: Array, totals?: object}>}
 */
async function fetchUsage() {
    if (!configured()) {
        // Deliberately distinguishable from a failure: the panel says "not set
        // up yet" rather than "the game is down", which are different jobs for
        // whoever is reading it.
        return { ok: false, reason: 'not-configured' };
    }

    let res;
    try {
        res = await httpFetch(BASE_URL() + '/api/usage', {
            method: 'GET',
            headers: { 'x-usage-key': KEY(), accept: 'application/json' },
            timeoutMs: TIMEOUT_MS
        });
    } catch (err) {
        // Never let the key reach a log line. The message from a socket error
        // is about the host, but the URL and headers are not worth risking.
        return { ok: false, reason: 'unreachable' };
    }

    if (!res.ok) {
        // The game answers 404 to a wrong or missing key — it does not confirm
        // the route exists — so 404 here means "the key is wrong", not "the
        // path moved". Saying so saves an hour of looking in the wrong place.
        return { ok: false, reason: res.status === 404 ? 'rejected' : 'error', status: res.status };
    }

    let body;
    try {
        body = await res.json();
    } catch (_) {
        return { ok: false, reason: 'bad-json' };
    }

    // The game is a separate deployment that can be updated without this one.
    // Shape what comes back rather than handing the admin page whatever the
    // other side happens to be sending this week.
    const schools = Array.isArray(body && body.schools) ? body.schools : [];
    return {
        ok: true,
        schools: schools.slice(0, 200).map((s) => ({
            name:      String((s && s.name) || '').slice(0, 200),
            teachers:  Number(s && s.teachers) || 0,
            classes:   Number(s && s.classes) || 0,
            pupils:    Number(s && s.pupils) || 0,
            createdAt: (s && s.created_at) || null
        })),
        totals: {
            schools:  Number(body && body.totals && body.totals.schools)  || 0,
            teachers: Number(body && body.totals && body.totals.teachers) || 0,
            classes:  Number(body && body.totals && body.totals.classes)  || 0,
            pupils:   Number(body && body.totals && body.totals.pupils)   || 0,
            runs:     Number(body && body.totals && body.totals.runs)     || 0
        }
    };
}

module.exports = { fetchUsage, configured, BASE_URL, TIMEOUT_MS };
