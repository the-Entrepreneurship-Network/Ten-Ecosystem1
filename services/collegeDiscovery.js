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
const { contactsFromPosting, nameNear } = require('./v2/recruiterContacts');

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
 * Who is worth writing to at a college, in the order we would rather reach.
 *
 * The earlier version of this file was built for the opposite brief — keep the
 * placement desk, drop every administrator — so `rector`, `vc`, `chancellor`
 * and `registrar` sat in the BLOCK list, and `pa2rector@jntuh.ac.in` was
 * thrown away on the first live run. The brief is now the authorities: the
 * people who can actually say yes to a partnership. Those names move from the
 * block list into tier 2, and what stays blocked is only the desks that
 * genuinely cannot action an internship offer.
 *
 * Tier 1 — the desk that runs placements. "tnp" and "cdc" are as common as
 *          "placement" on Indian college sites: Training & Placement, Career
 *          Development Cell.
 */
const PLACEMENT_DESK = /placement|tpo|tnp|cdc|training|career|internship|corporate|industry|recruit|outreach/i;

/**
 * Tier 2 — the authority who can sign one off.
 *
 * The `pa|po|so|ao` prefix is deliberate: `pa2rector@` is the Personal
 * Assistant to the Rector, which IS how you reach the Rector. A university
 * publishes the PA's address precisely so that people write to it.
 */
const AUTHORITY_DESK = new RegExp('^(?:pa2?|po|so|ao|office)?[._-]?(?:' + [
    'principal', 'director', 'dean', 'hod', 'head', 'registrar',
    'vc', 'vice-?chancellor', 'chancellor', 'pro-?vc', 'rector', 'provost',
    'chairman', 'chairperson', 'president', 'secretary'
].join('|') + ')\\w*', 'i');

/** Tier 3 — the front office, which forwards what it cannot answer itself. */
const FRONT_OFFICE = /^(?:info|admin|office|enquiry|enquiries|contact|academics?|mail|college|institute)\w*/i;

/**
 * Desks that exist at every college and will never action an internship offer.
 *
 * The first live run returned library@ and accounts@. Neither forwards a
 * partnership enquiry; they delete it. Mailing them is not merely wasted — it
 * earns complaints against a domain that also carries students' certificates.
 *
 * Admissions is here deliberately: that desk handles people applying TO the
 * college, not students already in it. So is the Controller of Examinations.
 */
const WRONG_DESK = new RegExp('^(?:pa2?|po|so|ao)?[._-]?(?:' + [
    'controller', 'coe', 'exam', 'examination', 'result',
    'account', 'accounts', 'finance', 'audit', 'purchase', 'store', 'tender',
    'library', 'librarian', 'hostel', 'warden', 'mess', 'canteen',
    'transport', 'estate', 'maintenance', 'engineer', 'security', 'medical',
    'legal', 'grievance', 'antiragging', 'rti', 'vigilance', 'nss', 'ncc',
    'admission', 'admissions', 'fee', 'fees', 'scholarship', 'sports'
].join('|') + ')\\w*$', 'i');

/**
 * A student's own address, which this agent must never collect.
 *
 * Writing to the authorities is outreach to an institution. Harvesting the
 * student body's addresses off a results page is a different thing entirely,
 * and it is not what this is for.
 *
 * The local-part shapes are the Indian roll-number conventions — `21cse045`,
 * `b190234`, `2020ucs1234` — written tightly enough that `tpo2@`,
 * `principal2024@` and `hod.cse@` all survive: the second rule needs five or
 * more digits after at most three letters, which no desk name produces.
 *
 * The word rule is exact-plus-digits (`student`, `students`, `alumni2021`) on
 * purpose. A looser prefix match would have taken `internship@` — a placement
 * address — and `studentaffairs@`, which is the Dean of Students, an authority
 * this is supposed to find.
 */
const STUDENT_LOCAL = /^(?:students?|stud|alumni)\d*$|^\d{2,4}[a-z]{1,5}\d{2,}$|^[a-z]{1,3}\d{5,}$/i;

/** @student.college.ac.in and its cousins. The dot is required, so `sturm.` survives. */
const STUDENT_DOMAIN = /^(?:students?|stu|alumni|learners?|scholars?)\./i;

/** Is this address a desk we are willing to write to at all? */
function isMailableDesk(email) {
    const [local, domain] = String(email || '').toLowerCase().split('@');
    if (!local || !domain) return false;
    if (STUDENT_LOCAL.test(local)) return false;
    if (STUDENT_DOMAIN.test(domain)) return false;
    return !WRONG_DESK.test(local);
}

/**
 * How badly we want this one. Lower is better.
 *
 * The role text counts as well as the address, because the strict pass already
 * reads "Training and Placement Officer" out of the sentence around it — a
 * named officer at `rpsharma@` is the placement desk even though nothing in
 * the address says so.
 */
function rankOf(row) {
    const local = String((row && row.email) || '').split('@')[0];
    const role = String((row && (row.role || row.contactRole)) || '');
    if (PLACEMENT_DESK.test(local) || PLACEMENT_DESK.test(role)) return 1;
    if (AUTHORITY_DESK.test(local) || AUTHORITY_DESK.test(role)) return 2;
    if (FRONT_OFFICE.test(local)) return 3;
    return 4;   // a named individual with no stated role — still a human
}

/**
 * At most this many addresses per college.
 *
 * One mail to the placement officer and one to the Principal reaches two
 * people who decide different things. Fifteen mails to fifteen department HODs
 * from one sending domain is what spam filters are for, and this domain also
 * carries students' certificates.
 */
const MAX_PER_COLLEGE = Math.max(1, Math.min(5,
    parseInt(process.env.COLLEGE_MAX_CONTACTS, 10) || 2));

/**
 * Which of a page's addresses are worth keeping, best first.
 *
 * Pulled out as a pure function on purpose: tested as text, this rule once
 * passed while the wrong-desk check had been weakened to "has an email" — the
 * test was reading the shape of the code rather than what it does.
 *
 * @param {Array<{email: string, role?: string}>} rows
 * @param {number} [limit]
 * @returns {Array<object>} at most `limit` rows, placement desk first
 */
function selectContacts(rows, limit) {
    const cap = limit || MAX_PER_COLLEGE;
    return (rows || [])
        .filter((r) => r && r.email && isMailableDesk(r.email))
        .map((r, i) => ({ r, rank: rankOf(r), i }))
        // The index keeps the sort stable across engines: two addresses of the
        // same rank stay in the order the page published them.
        .sort((a, b) => (a.rank - b.rank) || (a.i - b.i))
        .slice(0, cap)
        .map((x) => x.r);
}

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

/**
 * The job title beside an address, in a college's vocabulary.
 *
 * recruiterContacts.roleNear() is not reused here because it knows corporate
 * titles — "Talent Partner", "Hiring Manager", "CTO" — and would never match
 * "Training and Placement Officer". Same job, different dictionary, so the
 * dictionary is the only thing that is separate.
 */
const COLLEGE_ROLE = new RegExp('\\b(' + [
    'Training (?:and|&) Placement Officer', 'Placement Officer', 'Placement Co-?ordinator',
    'Placement Head', 'Placement Director', 'Head[, ]+Training (?:and|&) Placement',
    'T\\.?P\\.?O\\.?', 'Dean[, ]+(?:Academics?|Students?|Placements?|Industry Relations)',
    'Vice[- ]?Chancellor', 'Pro[- ]?Vice[- ]?Chancellor', 'Registrar', 'Rector',
    'Principal', 'Director', 'Head of Department', 'H\\.?O\\.?D\\.?',
    'Chairman', 'Chairperson', 'Secretary', 'Correspondent'
].join('|') + ')\\b', 'i');

/** A role title near the address, read from the college's own page. */
function collegeRoleNear(text, index) {
    const window = String(text).slice(Math.max(0, index - 220), index + 140);
    const m = window.match(COLLEGE_ROLE);
    return m ? m[1].replace(/\s+/g, ' ').trim() : '';
}

/**
 * The relaxed pass. Same cue requirement, a college's idea of a real mailbox.
 *
 * It used to push `name: '', role: '', phone: ''` — three hard-coded blanks —
 * so every address the strict pass missed arrived as a bare mailbox with no
 * human attached, and the preview could only say "Dear Sir/Madam". The page
 * usually names the officer right beside the address; this reads it.
 */
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
        out.push({
            email,
            name: nameNear(text, m.index),
            role: collegeRoleNear(text, m.index),
            phone: '',
            sourceUrl: url,
            company: college || ''
        });
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
            // Enough desks in hand. Walking the remaining paths cannot add a
            // row that survives the cap, so it is seven fetches for nothing.
            if (found.size >= MAX_PER_COLLEGE) break;
        }
        if (i < PATHS.length - 1) await new Promise((r) => setTimeout(r, DELAY_MS));
    }

    /*
     * Ranked, then capped. Everything this college published is in `found`;
     * what comes back is the best MAX_PER_COLLEGE of it — the placement desk
     * first, then an authority who can approve a partnership.
     *
     * The cap is the point. Every extra address is the same institution mailed
     * again from the same sending domain about the same thing, and that is how
     * a domain that also carries certificates earns a spam reputation.
     */
    return selectContacts([...found.values()]);
}

/* ── is this address able to receive mail at all? ──────────────────────────── */

/*
 * Checked per DOMAIN, not per address, and remembered for the life of the
 * process: one college publishes several addresses on one domain, and asking
 * the resolver the same question four times is three round trips wasted.
 */
const mxCache = new Map();

/**
 * Does this domain accept mail?
 *
 * Node's own resolver — no dependency, no API, no cost. This is the difference
 * between a list that sends and a list that bounces: a college that moved its
 * site, a typo'd domain on a contact page, a department that was wound up.
 * None of them are visible to a regex, and all of them bounce.
 *
 * ponytail: DNS only. The honest ceiling is that a domain with a mail server
 * can still reject one particular mailbox, which only a live SMTP RCPT probe
 * would catch — and that gets the sending IP blocklisted while most Indian
 * college servers accept-all anyway, so it would buy false confidence rather
 * than fewer bounces. If bounce rates stay high after this, read the bounces.
 */
async function hasMx(domain) {
    const d = String(domain || '').trim().toLowerCase();
    if (!d || !d.includes('.')) return false;
    if (mxCache.has(d)) return mxCache.get(d);

    const remember = (ok) => { mxCache.set(d, ok); return ok; };
    const dns = require('dns').promises;

    try {
        const mx = await dns.resolveMx(d);
        if (mx && mx.some((r) => r && r.exchange)) return remember(true);
    } catch (err) {
        const code = err && err.code;
        // No such domain: permanent, worth remembering.
        if (code === 'ENOTFOUND' || code === 'NXDOMAIN') return remember(false);
        // ENODATA means the domain exists but publishes no MX — fall through
        // to the A-record rule below. Anything else (timeout, SERVFAIL) is the
        // resolver having a bad moment, so it is NOT cached: a blip must not
        // condemn a real college for the lifetime of the process.
        if (code !== 'ENODATA') return false;
    }

    // RFC 5321 §5.1: a domain with an address record and no MX still takes
    // mail there. Small colleges on shared hosting really do this.
    try {
        const a = await dns.resolve4(d);
        return remember(!!(a && a.length));
    } catch (_) {
        return remember(false);
    }
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
    const wellFormed = all.filter((r) => r && r.email && r.sourceUrl);
    let skipped = all.length - wellFormed.length;
    if (!wellFormed.length) return { added: 0, skipped, unroutable: 0 };

    /*
     * An address whose domain cannot receive mail is not a contact, it is a
     * future bounce. Rejected here rather than at send time so the dashboard
     * count is the number of colleges actually reachable.
     */
    const checked = await Promise.all(wellFormed.map(async (r) =>
        ({ row: r, ok: await hasMx(String(r.email).split('@')[1]) })));
    const valid = checked.filter((c) => c.ok).map((c) => c.row);
    const unroutable = checked.length - valid.length;
    skipped += unroutable;
    if (!valid.length) return { added: 0, skipped, unroutable };

    // Required here rather than at the top so the parsing half of this file —
    // which is pure text work — loads and tests without a database driver.
    const CollegeContact = require('../models/CollegeContact');
    let added = 0;
    for (const row of valid) {
        try {
            const res = await CollegeContact.updateOne(
                { email: row.email },
                { $setOnInsert: { ...row, mxOk: true, mxCheckedAt: new Date() } },
                { upsert: true }
            );
            if (res.upsertedCount) added++; else skipped++;
        } catch (err) {
            // A duplicate key here means a parallel run won the race, which is
            // the index doing its job, not a failure worth stopping for.
            skipped++;
        }
    }
    return { added, skipped, unroutable };
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

/**
 * The longest one college may take before the run gives up on it.
 *
 * Eight paths at a six-second timeout with 350ms between them is about fifty
 * seconds in the worst honest case, so ninety is headroom rather than a
 * second ceiling.
 *
 * This exists even though httpFetch now enforces its own deadline, because
 * the promise this guards is the whole college — every fetch, every parse,
 * every save. One worker that never returns leaves `running: true` forever
 * and the dashboard sits at "370 of 371" with a progress bar that never
 * finishes, which is exactly what happened. A run must always end.
 */
const COLLEGE_DEADLINE_MS = Math.max(10000,
    parseInt(process.env.COLLEGE_DEADLINE_MS, 10) || 90000);

/** Reject if `promise` has not settled in `ms`. The loser is abandoned. */
function withDeadline(promise, ms, label) {
    let timer = null;
    return Promise.race([
        promise,
        /* NOT unref'd. This timer is the only thing guaranteeing the run
           makes progress — a hung college holds no socket and no handle of
           its own, so an unref'd deadline let the process fall idle and exit
           with the run still "running". It is cleared the moment either side
           settles, so it holds the loop for at most `ms`. */
        new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error(label + ' exceeded ' + ms + 'ms')), ms);
        })
    ]).then(
        (v) => { clearTimeout(timer); return v; },
        (e) => { clearTimeout(timer); throw e; }
    );
}

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
                const rows = await withDeadline(
                    discover(site, { college: '', state: '' }), COLLEGE_DEADLINE_MS, site);
                if (rows.length) {
                    const { added, skipped } = await save(rows);
                    current.added += added;
                    current.skipped += skipped;
                } else {
                    current.skipped += 1;   // visited, published nothing usable
                }
            } catch (err) {
                // Counted and moved past. One college with an expired
                // certificate, a redirect loop or a server that never stops
                // talking must not end a run of three hundred and seventy.
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
    runBulk, runStatus, withDeadline, PATHS, CONCURRENCY, MAX_PER_COLLEGE,
    COLLEGE_DEADLINE_MS,
    PLACEMENT_DESK, AUTHORITY_DESK, FRONT_OFFICE, WRONG_DESK,
    STUDENT_LOCAL, STUDENT_DOMAIN,
    isMailableDesk, rankOf, selectContacts, hasMx
};
