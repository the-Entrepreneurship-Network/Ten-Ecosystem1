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

/*
 * A dead host used to cost 105 seconds: eight paths, each waiting the full
 * 12-second timeout, with 1.2 seconds of politeness between them. Across 177
 * colleges — many of which are slow or simply down — that made a run take
 * closer to an hour than the eight minutes it was advertised as.
 *
 * Six seconds is long enough for a college site that is merely slow. The
 * delay stays only because it is the same host being asked twice.
 */
const FETCH_TIMEOUT_MS = parseInt(process.env.COLLEGE_FETCH_TIMEOUT_MS, 10) || 6000;
const DELAY_MS = parseInt(process.env.COLLEGE_PATH_DELAY_MS, 10) || 350;
const MAX_BYTES = 600 * 1024;

/*
 * Give up on a host after this many requests in a row fail to connect.
 *
 * A 404 means the server is there and that path is wrong, so it does not
 * count — the next path is worth trying. Two refused connections mean the
 * host is down, and the remaining six paths will be down too.
 */
const DEAD_HOST_STREAK = 2;

/**
 * Where colleges put this. Ordered by how likely the page is to hold the
 * placement office rather than the switchboard, because the first page that
 * yields an address wins and a `tpo@` beats a `reception@`.
 */
const PATHS = Object.freeze([
    '/placement', '/placements', '/training-and-placement',
    '/tpo', '/career', '/contact-us', '/contact', '/'
]);

/**
 * The desk that actually handles this.
 *
 * "tnp" and "cdc" are as common as "placement" on Indian college sites —
 * Training & Placement, Career Development Cell.
 */
const PLACEMENT_HINT = /placement|tpo|tnp|cdc|training|career|internship|corporate|industry|recruit|outreach/i;

/**
 * Desks that exist at every college and will never action an internship offer.
 *
 * The first live run returned pa2rector@, library@ and accounts@ — the PA to
 * the Rector, the library and the finance office. None of them forward a
 * partnership enquiry; they delete it. Mailing them is not merely wasted, it
 * earns complaints against a domain that also carries certificates.
 *
 * Admissions is on the list deliberately: that desk handles people applying TO
 * the college, not students already in it.
 */
/**
 * Which of a page's addresses are worth keeping, and in what order.
 *
 * Pulled out as a pure function on purpose: tested as text, this rule passed
 * while the wrong-desk check had been weakened to "has an email" — the test
 * was reading the shape of the code rather than what it does.
 *
 * @param {Array<{email: string}>} rows
 * @returns {Array<{email: string}>}
 */
function selectContacts(rows) {
    const kept = (rows || []).filter(
        (r) => r && r.email && !WRONG_DESK.test(String(r.email).split('@')[0]));
    const placement = kept.filter((r) => PLACEMENT_HINT.test(r.email.split('@')[0]));
    return placement.length ? placement : kept;
}

const WRONG_DESK = new RegExp('^(?:pa2?|po|so|ao)?[._-]?(?:' + [
    'rector', 'vc', 'vicechancellor', 'chancellor', 'pro-?vc',
    'registrar', 'controller', 'coe', 'exam', 'examination', 'result',
    'account', 'accounts', 'finance', 'audit', 'purchase', 'store', 'tender',
    'library', 'librarian', 'hostel', 'warden', 'mess', 'canteen',
    'transport', 'estate', 'maintenance', 'engineer', 'security', 'medical',
    'legal', 'grievance', 'antiragging', 'rti', 'vigilance', 'nss', 'ncc',
    'admission', 'admissions', 'fee', 'fees', 'scholarship', 'sports'
].join('|') + ')\\w*$', 'i');

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
    // https, not http: nearly every .ac.in is TLS-only now, and starting on
    // http costs a redirect hop on EVERY request — eight per college, 177
    // colleges — or fails outright where the server does not redirect.
    if (!/^https?:\/\//i.test(raw)) raw = 'https://' + raw;
    try {
        const u = new URL(raw);
        if (!/\./.test(u.hostname)) return '';
        return u.origin;
    } catch (_) {
        return '';
    }
}

/**
 * Fetch one page.
 *
 * Returns `reachable: false` only when the host did not answer at all. A 404
 * is reachable — it means try the next path, not abandon the college — and
 * conflating the two is what made a dead host cost eight timeouts.
 *
 * @returns {Promise<{reachable: boolean, html: string}>}
 */
async function fetchPage(url) {
    let res;
    try {
        res = await httpFetch(url, { headers: UA, timeoutMs: FETCH_TIMEOUT_MS });
    } catch (_) {
        return { reachable: false, html: '' };
    }
    if (!res) return { reachable: false, html: '' };
    if (!res.ok) return { reachable: true, html: '' };
    const type = (res.headers && res.headers.get && res.headers.get('content-type')) || '';
    if (type && !/html|text\/plain/i.test(type)) return { reachable: true, html: '' };
    let body;
    try {
        body = await res.text();
    } catch (_) {
        return { reachable: true, html: '' };
    }
    // A prospectus PDF rendered as HTML can run to megabytes; nothing past the
    // first few hundred KB is a contact block.
    return { reachable: true, html: body.length > MAX_BYTES ? body.slice(0, MAX_BYTES) : body };
}

/*
 * Addresses worth having from a COLLEGE, which a job advert's rules reject.
 *
 * services/v2/recruiterContacts.js drops info@, admin@ and office@ because on
 * a company's job advert they are a catch-all nobody reads. On a college's own
 * contact page they are frequently the only address published, and they reach
 * the front office, which is exactly who forwards a partnership enquiry.
 *
 * So this runs as a SECOND pass, only on a page where the strict rules found
 * nothing. The genuinely useless ones stay out.
 */
const COLLEGE_OK_LOCALPART = /^(info|admin|office|enquiry|enquiries|contact|principal|director|registrar|dean|hod|head|academics?|admission|admissions)[._-]?\w*$/i;
const NEVER_MAIL = /^(no-?reply|do-?not-?reply|postmaster|abuse|webmaster|notifications?|unsubscribe|mailer|bounce|automated|spam)$/i;
const RE_EMAIL_ANY = /[\w.+-]+@[\w-]+\.[\w.]{2,}/g;

/** The relaxed pass. Same cue requirement, a college's idea of a real mailbox. */
function collegeContactsFrom(text, url, college) {
    const out = [];
    const seen = new Set();
    RE_EMAIL_ANY.lastIndex = 0;
    let m;
    while ((m = RE_EMAIL_ANY.exec(text)) !== null) {
        const email = m[0].replace(/[.,;)]+$/, '').toLowerCase();
        const [local] = email.split('@');
        if (!local || seen.has(email)) continue;
        if (NEVER_MAIL.test(local)) continue;
        if (!COLLEGE_OK_LOCALPART.test(local)) continue;
        // The same honesty check the strict pass uses: the sentence around the
        // address has to be inviting contact, not mentioning it in a footer.
        const around = text.slice(Math.max(0, m.index - 220), m.index + 160);
        if (!/\b(email|e-mail|mail|contact|reach|write|enquir|phone|call)\b/i.test(around)) continue;
        seen.add(email);
        out.push({ email, name: '', role: '', phone: '', sourceUrl: url, company: college || '' });
    }
    return out;
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
    let deadStreak = 0;

    for (let i = 0; i < PATHS.length; i++) {
        const url = origin + PATHS[i];
        const { reachable, html } = await fetchPage(url);

        if (!reachable) {
            // The host itself did not answer. Trying seven more paths on a
            // machine that is down is seven more full timeouts for nothing.
            if (++deadStreak >= DEAD_HOST_STREAK) break;
        } else {
            deadStreak = 0;
        }

        if (html) {
            const text = htmlToText(html);
            /*
             * The wrong-desk filter runs BEFORE the fallback decision, not
             * after. Applying it later meant a page publishing only accounts@
             * and info@ looked like a hit to the strict pass, skipped the
             * fallback, and then lost accounts@ to the filter — yielding
             * nothing from a college that had published a usable address.
             */
            let rows = selectContacts(contactsFromPosting({
                description: text,
                title: titleOf(html),
                url,
                company: meta.college || '',
                source: 'college-page'
            }));

            // Only when the strict rules found nothing usable on THIS page: a
            // college that publishes office@ and nothing else is still worth
            // reaching. Selection runs on the fallback too, or a page holding
            // only accounts@ would look like a hit and then yield nothing.
            if (!rows.length) rows = selectContacts(collegeContactsFrom(text, url, meta.college));

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

    /*
     * If the placement office was found, return ONLY it.
     *
     * Once tpo@ is in hand, principal@ and info@ from the same college are not
     * extra reach — they are the same institution mailed twice, from the same
     * sending domain, about the same thing. One right address beats three.
     */
    return selectContacts([...found.values()]);
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
 * Each site is a DIFFERENT host, so this is not hammering anybody — it is a
 * dozen separate servers each being asked for one page. The limit exists to
 * bound sockets and memory, not to be polite to one server; politeness to a
 * single host is DELAY_MS, which still applies between that host's own pages.
 *
 * Was 4, which with the old 12-second timeout made a full run closer to an
 * hour than the eight minutes it was sold as.
 */
const CONCURRENCY = Math.max(1, Math.min(24, parseInt(process.env.COLLEGE_AGENT_CONCURRENCY, 10) || 12));

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
    runBulk, runStatus, PATHS, PLACEMENT_HINT, WRONG_DESK, selectContacts, CONCURRENCY
};
