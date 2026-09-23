'use strict';

/**
 * Finding the placement office at a college, from the college's own site.
 *
 * The extraction is not written here. services/v2/recruiterContacts.js already
 * does exactly this job for hiring teams — pull the addresses a page publishes,
 * drop the machinery addresses, and keep one only when the sentence around it
 * invites contact — and a college placement page is the same shape of document
 * as a job advert: an organisation publishing a way to reach it about
 * recruitment. So `contactsFromPosting` is handed the page text and used
 * unchanged. Its noise filters and its cue check are the honesty of this file.
 *
 * ponytail: pages are fetched one at a time, and robots.txt is not parsed.
 * Six known paths per college with an identifying User-Agent is not the
 * traffic robots.txt exists to stop, and the whole point is the page the
 * college published to be read. If this ever runs over thousands of domains
 * per hour, parse robots.txt and add a per-host delay before widening it.
 */

const { httpFetch } = require('./v2/httpFetch');
const { contactsFromPosting } = require('./v2/recruiterContacts');

/* Says who we are and where to complain, exactly as the job agent does. */
const UA = { 'User-Agent': 'TEN-CollegeOutreach/1.0 (+https://entrepreneurshipnetwork.net)' };

const FETCH_TIMEOUT_MS = 12000;
const DELAY_MS = 1200;
const MAX_BYTES = 600 * 1024;

/**
 * Where colleges put this. Ordered by how likely the page is to hold the
 * placement office rather than the switchboard, because the first page that
 * yields an address wins and a `tpo@` beats a `reception@`.
 */
const PATHS = Object.freeze([
    '/placement', '/placements', '/training-and-placement',
    '/tpo', '/career', '/contact-us', '/contact', '/'
]);

/** Localparts that mean "this is the placement office", ranked first. */
const PLACEMENT_HINT = /placement|tpo|training|career|internship|corporate|industry|recruit/i;

/**
 * Page HTML to readable text.
 *
 * Script and style bodies go first — a minified bundle is full of strings that
 * look like addresses and none of them belong to a human. Everything else
 * becomes a space so that words either side of a tag do not fuse into one
 * token and defeat the cue check.
 */
function htmlToText(html) {
    return String(html || '')
        .replace(/<(script|style|noscript)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
        .replace(/<!--[\s\S]*?-->/g, ' ')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/(p|div|tr|li|h[1-6])>/gi, '\n')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(parseInt(d, 10)))
        .replace(/[ \t]{2,}/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

/** The <title>, used as the evidence label on the stored row. */
function titleOf(html) {
    const m = String(html || '').match(/<title[^>]*>([\s\S]{0,200}?)<\/title>/i);
    return m ? m[1].replace(/\s+/g, ' ').trim() : '';
}

/** Normalise whatever the dataset holds into an absolute origin. */
function toOrigin(website) {
    let raw = String(website || '').trim();
    if (!raw) return '';
    if (!/^https?:\/\//i.test(raw)) raw = 'http://' + raw;
    try {
        const u = new URL(raw);
        if (!/\./.test(u.hostname)) return '';
        return u.origin;
    } catch (_) {
        return '';
    }
}

/** Fetch one page as text. Returns '' for anything that is not readable HTML. */
async function fetchText(url) {
    let res;
    try {
        res = await httpFetch(url, { headers: UA, timeoutMs: FETCH_TIMEOUT_MS });
    } catch (_) {
        return '';
    }
    if (!res || !res.ok) return '';
    const type = (res.headers && res.headers.get && res.headers.get('content-type')) || '';
    if (type && !/html|text\/plain/i.test(type)) return '';
    let body;
    try {
        body = await res.text();
    } catch (_) {
        return '';
    }
    // A prospectus PDF rendered as HTML can run to megabytes; nothing past the
    // first few hundred KB is a contact block.
    return body.length > MAX_BYTES ? body.slice(0, MAX_BYTES) : body;
}

/**
 * Every published contact this college's site offers, best first.
 *
 * @param {string} website  the college's site, with or without a scheme
 * @param {{college?: string, state?: string}} meta
 * @returns {Promise<Array<object>>} rows shaped for `saveContacts`
 */
async function discoverFromSite(website, meta = {}) {
    const origin = toOrigin(website);
    if (!origin) return [];

    const found = new Map();

    for (let i = 0; i < PATHS.length; i++) {
        const url = origin + PATHS[i];
        const html = await fetchText(url);
        if (html) {
            const rows = contactsFromPosting({
                description: htmlToText(html),
                title: titleOf(html),
                url,
                company: meta.college || '',
                source: 'college-page'
            });
            rows.forEach((r) => {
                if (!r.email) return;                 // a bare phone is not mailable
                const key = r.email.toLowerCase();
                if (found.has(key)) return;
                found.set(key, {
                    email: key,
                    college: meta.college || '',
                    state: meta.state || '',
                    website: origin,
                    sourceUrl: url,
                    contactName: r.name || '',
                    contactRole: r.role || '',
                    phone: r.phone || '',
                    via: 'page-discovery'
                });
            });
            // The placement page answered; the switchboard page adds nothing.
            if ([...found.values()].some((r) => PLACEMENT_HINT.test(r.email.split('@')[0]))) break;
        }
        if (i < PATHS.length - 1) await new Promise((r) => setTimeout(r, DELAY_MS));
    }

    return [...found.values()].sort((a, b) =>
        Number(PLACEMENT_HINT.test(b.email.split('@')[0])) - Number(PLACEMENT_HINT.test(a.email.split('@')[0])));
}

/**
 * Write rows, skipping any that already exist.
 *
 * `$setOnInsert` and nothing else is the whole point: a re-run must never
 * resurrect an address that opted out, reset a `status`, or overwrite a
 * contact name a human corrected by hand.
 */
async function saveContacts(rows) {
    const all = rows || [];
    // A row without an address or without the page it came from cannot be
    // justified, so it never reaches the database.
    const valid = all.filter((r) => r && r.email && r.sourceUrl);
    let skipped = all.length - valid.length;
    if (!valid.length) return { added: 0, skipped };

    // Required here rather than at the top so the parsing half of this file —
    // which is pure text work — loads and tests without a database driver.
    const CollegeContact = require('../models/CollegeContact');
    let added = 0;
    for (const row of valid) {
        try {
            const res = await CollegeContact.updateOne(
                { email: row.email }, { $setOnInsert: row }, { upsert: true }
            );
            if (res.upsertedCount) added++; else skipped++;
        } catch (err) {
            // A duplicate key here means a parallel run won the race, which is
            // the index doing its job, not a failure worth stopping for.
            skipped++;
        }
    }
    return { added, skipped };
}

/* ── the agent run ────────────────────────────────────────────────────────── */

/*
 * How many colleges are visited at once.
 *
 * Each site is a different host, so this is not hammering anybody — it is four
 * separate servers being asked for one page each. Sequentially, 177 colleges
 * at roughly ten seconds apiece is half an hour; at four it is about eight
 * minutes, which is the difference between a button somebody presses and one
 * they never press twice.
 */
const CONCURRENCY = Math.max(1, Math.min(8, parseInt(process.env.COLLEGE_AGENT_CONCURRENCY, 10) || 4));

/*
 * The state of the run in progress.
 *
 * ponytail: held in memory, not in Mongo. There is one app process, the run is
 * a few minutes long, and the only cost of losing it to a restart is pressing
 * the button again — a collection, a migration and a stale-run reaper would all
 * be real code to maintain for that. If this ever runs on more than one
 * process, or needs to survive a deploy, move it into its own small model.
 */
let current = {
    running: false, startedAt: null, finishedAt: null,
    total: 0, processed: 0, added: 0, skipped: 0, failed: 0, lastCollege: '', error: ''
};

/** A snapshot the dashboard can poll. */
function runStatus() {
    return { ...current };
}

/**
 * Visit every site and store what each one publishes.
 *
 * Never throws: one college with an expired certificate must not end a run of
 * a hundred and seventy-seven. A site that fails is counted and the run moves on.
 */
async function runBulk(sites, deps = {}) {
    if (current.running) return runStatus();

    /*
     * The two calls that touch the network and the database, injectable.
     * Without this the control flow here — every site visited once, a failure
     * not ending the run, two runs not overlapping — could only be tested by
     * actually crawling a hundred and seventy-seven colleges.
     */
    const discover = deps.discover || discoverFromSite;
    const save = deps.save || saveContacts;

    const list = [...new Set((sites || []).map((x) => String(x).trim()).filter(Boolean))];
    current = {
        running: true, startedAt: new Date(), finishedAt: null,
        total: list.length, processed: 0, added: 0, skipped: 0, failed: 0,
        lastCollege: '', error: ''
    };

    let cursor = 0;
    async function worker() {
        for (;;) {
            const i = cursor++;
            if (i >= list.length) return;
            const site = list[i];
            try {
                const rows = await discover(site, { college: '', state: '' });
                if (rows.length) {
                    const { added, skipped } = await save(rows);
                    current.added += added;
                    current.skipped += skipped;
                } else {
                    current.skipped += 1;   // visited, published nothing usable
                }
            } catch (err) {
                current.failed += 1;
            }
            current.processed += 1;
            current.lastCollege = site;
        }
    }

    try {
        await Promise.all(Array.from({ length: Math.min(CONCURRENCY, list.length) }, worker));
    } catch (err) {
        current.error = String(err && err.message || err).slice(0, 300);
    }
    current.running = false;
    current.finishedAt = new Date();
    return runStatus();
}

module.exports = {
    discoverFromSite, saveContacts, htmlToText, toOrigin, titleOf,
    runBulk, runStatus, PATHS, PLACEMENT_HINT, CONCURRENCY
};
