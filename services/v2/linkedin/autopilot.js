'use strict';

/**
 * The autopilot: the part of this feature that runs with nobody logged in.
 *
 * Every two hours, round the clock, the company page gets one hiring post for
 * one of the fourteen domains, with that domain's poster attached and that
 * domain's application link in the text. Twelve posts a day against fourteen
 * domains means a full lap takes twenty-eight hours, so the same domain never
 * lands at the same hour twice running. No staff member types anything, opens
 * anything or approves anything — that is the requirement, and every decision
 * below follows from it.
 *
 * **It queues, it does not publish.** The tick builds the post and saves it as
 * `scheduled`; the minute tick in scheduler.js is what talks to LinkedIn. That
 * split is worth the extra hop because the scheduler already has the parts
 * that are hard to get right and are now well covered by tests: the atomic
 * claim that stops two PM2 workers publishing the same thing, the dry-run
 * path for a server with no token, the re-check of the text at publish time,
 * and the failure recording. Duplicating any of that here would mean two
 * publish paths that have to stay in step forever.
 *
 * **One row per slot, enforced by the database.** The tick runs every few
 * minutes on every worker, so it will try to queue the same two-hour slot many
 * times over. `slot` is uniquely indexed, so the first insert wins and the
 * rest come back as a duplicate-key error which is caught and treated as
 * success — "somebody already queued this" is the normal outcome, not a fault.
 * Nothing here depends on the tick interval dividing the slot length, or on
 * two workers agreeing about anything; they agree because the slot key is a
 * pure function of the clock.
 *
 * **The text is checked even though the text is ours.** contentGuard runs on
 * every generated body before it is saved. It should never fire, because the
 * body comes from a constant. That is exactly why it is cheap to keep: the day
 * somebody edits domainPost.js and slips in a phone number or a stipend
 * figure, the guard catches it before the page does — and at twelve posts a
 * day, a mistake that reaches the feed reaches it twelve times before anybody
 * is at a desk.
 */

const fs = require('fs');
const path = require('path');

const domainPost = require('./domainPost');

/*
 * Posters live on disk as finished JPEGs rather than being drawn at post time.
 *
 * Drawing them here would mean a headless browser on the production box every
 * two hours, at three in the morning, with nobody watching it fail. The poster
 * for a domain does not change between posts — the facts on it are the
 * programme constants — so it is rendered once by poster-kit, committed, and
 * read as bytes. A missing file costs the post its image and nothing else.
 */
const POSTER_DIR = path.join(__dirname, '..', '..', '..', 'public', 'assets', 'linkedin-posters');

/* How far apart two posts are, in hours. Lives in domainPost.js because the
   rotation is computed from it there; re-exported here because it is the one
   number anybody reading this file wants to know. */
const SLOT_HOURS = domainPost.SLOT_HOURS;

function resolveDeps(deps) {
  const given = deps || {};
  return {
    LinkedInPost: given.LinkedInPost || require('../../../models/LinkedInPost'),
    guard: given.guard || require('./contentGuard'),
    posts: given.posts || domainPost,
    readPoster: given.readPoster || readPoster,
    now: given.now,
  };
}

/**
 * The poster bytes for a domain, or undefined.
 *
 * Undefined rather than throwing: a post with no image is a post, and the
 * alternative — a slot with no hiring post because a JPEG was missing — is
 * strictly worse.
 */
function readPoster(slug) {
  const file = path.join(POSTER_DIR, `${slug}.jpg`);
  try {
    const buf = fs.readFileSync(file);
    return buf && buf.length ? buf : undefined;
  } catch (e) {
    return undefined;
  }
}

/**
 * Which slot this instant belongs to.
 *
 * Every instant belongs to one — the clock never stops and neither does the
 * rotation — so unlike the weekend job this replaced, there is no "not today"
 * answer and no window to miss. A process that was down for six hours comes
 * back, computes the slot it is standing in, and queues that one. It does not
 * try to catch up on the three it slept through: a post that went out four
 * hours late is competing with the one that is about to go out on time, and
 * the feed only has so much patience.
 *
 * The shape still returns `ok` because callers branch on it and because a
 * future reason to skip a slot — a holiday, a pause switch — belongs here.
 */
function due(now) {
  const at = (now instanceof Date && !Number.isNaN(now.getTime())) ? now : new Date();
  return { ok: true, at, key: `slot:${domainPost.slotKey(at)}` };
}

/**
 * One tick. Never throws — it is called from a cron callback under PM2, where
 * an unhandled rejection takes the whole web process down, and the portal
 * failing to serve pages because a LinkedIn post could not be queued would be
 * an absurd way to lose a morning.
 */
async function tick(now, deps) {
  const d = resolveDeps(deps);
  const verdictOf = (t) => {
    try {
      return d.guard.review(t, { kind: 'opening' });
    } catch (e) {
      return { verdict: 'ok', issues: [] };
    }
  };

  const slot = due(now);
  if (!slot.ok) return { queued: false, reason: slot.reason };

  const domain = d.posts.pick(slot.at);
  const text = d.posts.body(domain);
  const checked = verdictOf(text);

  /* 'revise' is expected and ignored: the house style opens with a rocket and
     the guard has opinions about that. 'block' is not a style note — it means
     a slur, a threat, an individual's phone number or a discriminatory
     restriction is in the text, and none of those may reach the page whatever
     the reason they got there. */
  if (checked.verdict === 'block') {
    console.error('[linkedin-autopilot] refusing to queue: the content guard blocked the generated text');
    return { queued: false, reason: 'blocked by the content guard', issues: checked.issues };
  }

  let png;
  try {
    png = d.readPoster(domain.slug);
  } catch (e) {
    png = undefined;
  }

  const doc = {
    kind: 'opening',
    source: 'autopilot',
    slot: slot.key,
    domain: domain.name,
    draft: '',
    final: text,
    issues: checked.issues || [],
    verdict: checked.verdict === 'block' ? 'block' : checked.verdict || 'ok',
    poster: {
      template: 'domain-hiring',
      fields: { domain: domain.name, role: domain.role, alt: d.posts.altText(domain) },
      svg: '',
      png: png ? png.toString('base64') : '',
      withImage: Boolean(png),
    },
    status: 'scheduled',
    scheduledFor: slot.at,
    author: { role: 'system', id: 'autopilot', name: 'LinkedIn autopilot' },
    history: [{
      at: new Date(),
      by: 'autopilot',
      action: 'queued',
      note: `${domain.name} — ${png ? 'with poster' : 'text only, no poster on disk'}`,
    }],
  };

  try {
    const saved = await d.LinkedInPost.create(doc);
    console.log(`[linkedin-autopilot] queued ${slot.key} — ${domain.name}`);
    return { queued: true, slot: slot.key, domain: domain.name, withImage: doc.poster.withImage, id: saved && saved._id };
  } catch (e) {
    /* 11000 is the unique index on `slot` doing its job: another worker, or an
       earlier run of this one, already queued this two-hour slot. */
    if (e && (e.code === 11000 || e.code === 11001)) {
      return { queued: false, reason: 'already queued for this slot', slot: slot.key };
    }
    console.error('[linkedin-autopilot] could not queue the post:', e && e.message ? e.message : e);
    return { queued: false, reason: 'save failed', error: e && e.message ? e.message : String(e) };
  }
}

/**
 * The feed every signed-in person sees: the posts the agent has put on the
 * company page, newest first, each with its poster and its text.
 *
 * This is the whole of what a dashboard shows now, and it is the same for a
 * student as for the founder. That is deliberate. The section is not a console
 * — there is nothing here to operate — so there is no reason to hide it from
 * the people the posts are about, and every reason to show interns what their
 * company is publishing. What is NOT in this payload is everything that is
 * operational rather than public: failure counts, error strings, the
 * scheduling queue, the rotation, the token's expiry. Those exist in the
 * database; they are simply not this endpoint's business.
 *
 * `dryRun` posts are included and flagged. A server with no token records
 * every weekend post without sending it, and dropping those would leave a
 * fresh deployment showing an empty section that reads as broken — but
 * counting them silently as published would tell an intern the page said
 * something it never said.
 */
async function feed(deps, limit) {
  const d = resolveDeps(deps);
  const take = Math.max(1, Math.min(60, parseInt(limit, 10) || 30));

  const [rows, count] = await Promise.all([
    d.LinkedInPost.find({ status: 'published' })
      .sort({ publishedAt: -1, createdAt: -1 })
      .limit(take)
      .select('domain final publishedAt createdAt dryRun linkedin poster.withImage poster.fields')
      .lean(),
    d.LinkedInPost.countDocuments({ status: 'published' }),
  ]);

  return {
    count: typeof count === 'number' ? count : (rows || []).length,
    posts: (rows || []).map((p) => {
      const fields = (p.poster && p.poster.fields) || {};
      return {
        id: String(p._id),
        domain: p.domain || '',
        /* The whole post, not an excerpt. The section exists to show what was
           said; a truncated version of it would be a worse copy of LinkedIn. */
        text: String(p.final || ''),
        image: imageUrlFor(p),
        alt: String(fields.alt || ''),
        at: p.publishedAt || p.createdAt,
        url: (p.linkedin && p.linkedin.url) || '',
        live: !p.dryRun,
      };
    }),
  };
}

/**
 * Where the browser should fetch this post's poster from.
 *
 * A weekend post's poster is one of the fourteen committed plates, so it is
 * served as a static file: no database round trip, cached by the browser, and
 * the same bytes for every reader. Anything else — an older post written by
 * hand, or a domain with no plate — falls back to the route that reads the
 * stored image off the document. A post with no image at all gets no URL and
 * the card renders as text, which is a card.
 */
function imageUrlFor(post) {
  const p = post || {};
  if (p.poster && p.poster.withImage === false) return '';
  const domain = domainPost.byName(p.domain);
  if (domain) return `/assets/linkedin-posters/${domain.slug}.jpg`;
  if (p.poster && p.poster.withImage) return `/api/v2/linkedin/feed/${String(p._id)}/image`;
  return '';
}

/**
 * What the read-only dashboard section shows: how many posts the agent has
 * put out, and the last few of them.
 *
 * Counts every post the page has ever made, not just the autopilot's, because
 * "how many posts has this thing done" is a question about the page.
 */
async function stats(deps, limit) {
  const d = resolveDeps(deps);
  const take = Math.max(1, Math.min(50, parseInt(limit, 10) || 12));

  const [counts, recent, next] = await Promise.all([
    d.LinkedInPost.aggregate([{ $group: { _id: '$status', n: { $sum: 1 } } }]),
    d.LinkedInPost.find({ status: { $in: ['published', 'failed'] } })
      .sort({ publishedAt: -1, createdAt: -1 })
      .limit(take)
      .select('domain final status publishedAt createdAt dryRun source linkedin error poster.withImage')
      .lean(),
    d.LinkedInPost.find({ status: { $in: ['scheduled', 'publishing'] } })
      .sort({ scheduledFor: 1 })
      .limit(5)
      .select('domain scheduledFor status source')
      .lean(),
  ]);

  const by = {};
  for (const row of counts || []) by[row._id] = row.n;
  const published = by.published || 0;

  return {
    published,
    failed: by.failed || 0,
    scheduled: (by.scheduled || 0) + (by.publishing || 0),
    total: Object.keys(by).reduce((n, k) => n + by[k], 0),
    schedule: { everyHours: SLOT_HOURS, perDay: Math.round(24 / SLOT_HOURS), timezone: 'Asia/Kolkata' },
    upcoming: (next || []).map((p) => ({
      domain: p.domain || '',
      scheduledFor: p.scheduledFor,
      status: p.status,
      source: p.source || 'agent',
    })),
    recent: (recent || []).map((p) => ({
      id: String(p._id),
      domain: p.domain || '',
      status: p.status,
      source: p.source || 'agent',
      dryRun: Boolean(p.dryRun),
      withImage: !(p.poster && p.poster.withImage === false),
      at: p.publishedAt || p.createdAt,
      url: (p.linkedin && p.linkedin.url) || '',
      error: p.error || '',
      excerpt: firstLine(p.final),
    })),
  };
}

function firstLine(text) {
  const s = String(text || '').split('\n').find((l) => l.trim()) || '';
  return s.trim().slice(0, 160);
}

/**
 * The next few weekend slots and the domain each one will get — shown in the
 * dashboard so the rotation is visible rather than a black box, and computable
 * without touching the database because it is a pure function of the date.
 */
function forecast(now, count) {
  const at = (now instanceof Date && !Number.isNaN(now.getTime())) ? now : new Date();
  const want = Math.max(1, Math.min(14, parseInt(count, 10) || 6));
  const slotMs = SLOT_HOURS * 3600000;
  /* Start at the NEXT slot, not this one: this one is either already queued
     or about to be, and listing it under "coming up" would have a reader
     waiting two hours for something that went out five minutes ago. */
  const first = domainPost.slotStart(at).getTime() + slotMs;
  const out = [];
  for (let i = 0; i < want; i += 1) {
    const when = new Date(first + i * slotMs);
    const domain = domainPost.pick(when);
    out.push({
      at: when.toISOString(),
      date: domainPost.istDateKey(when),
      slot: domainPost.slotKey(when),
      domain: domain.name,
      role: domain.role,
    });
  }
  return out;
}

/* ── cron ───────────────────────────────────────────────────────────────── */

let task = null;
let firstTimer = null;
let running = false;

/*
 * How long after boot the first tick fires.
 *
 * Short enough to read as "it posted the moment we deployed", long enough that
 * mongoose has finished connecting. Mongoose buffers commands until it does,
 * so a write at second zero would work — but it would also be the first thing
 * a cold process does, racing the connection, the index build on `slot` and
 * whatever else start-up is doing. Ten seconds costs nothing and removes the
 * whole class of question.
 */
const FIRST_TICK_MS = 10 * 1000;

/** One tick, guarded so two overlapping runs cannot both claim a slot. */
function runTick(why) {
  if (running) return Promise.resolve();
  running = true;
  return Promise.resolve()
    .then(() => tick(new Date()))
    .then((res) => {
      if (res && res.queued) console.log(`[linkedin-autopilot] ${why}: queued ${res.domain}`);
    })
    .catch((e) => { console.error('[linkedin-autopilot] tick failed:', e && e.message ? e.message : e); })
    .then(() => { running = false; });
}

/**
 * Start the checks: one straight away, then every five minutes.
 *
 * **The first one is the deploy's post.** A process that has just come up sits
 * inside some two-hour slot, and if nothing has filled that slot yet it should
 * fill it now rather than wait up to five minutes for the next cron edge. On
 * the very first deploy that is the difference between a company page that
 * posts the moment the change ships and one that appears to do nothing for
 * five minutes. It is safe to run on every boot, not just the first: a restart
 * halfway through a slot already posted loses the insert to the unique index
 * on `slot`, which is the same mechanism that already stops two PM2 workers
 * posting the same thing — and several workers booting together is exactly
 * that case.
 *
 * **Then every five minutes**, rather than a cron firing on the even hours: a
 * cron that fires while the box is restarting misses its slot outright, and
 * with one post every two hours a missed slot is a two-hour hole. A repeating
 * check that is a no-op twenty-three times out of twenty-four costs nothing.
 *
 * Off under NODE_ENV=test for the same reason as the scheduler — a registered
 * cron task keeps the Jest run alive and CI hangs.
 */
function start() {
  if (process.env.NODE_ENV === 'test') return null;
  if (process.env.LINKEDIN_AUTOPILOT_DISABLED) return null;
  if (task) return task;

  const cron = require('node-cron');
  task = cron.schedule('*/5 * * * *', () => { runTick('scheduled check'); });

  firstTimer = setTimeout(() => { runTick('first check after start-up'); }, FIRST_TICK_MS);
  /* Do not hold the event loop open on this alone; the web server is what
     keeps the process alive, and a lingering timer would delay a clean exit. */
  if (firstTimer && typeof firstTimer.unref === 'function') firstTimer.unref();

  console.log(
    `[linkedin-autopilot] first post in ${FIRST_TICK_MS / 1000}s, `
    + `then one every ${SLOT_HOURS} hours, round the clock`,
  );
  announceReach();
  return task;
}

/**
 * Say, at start-up, whether any of this will actually reach LinkedIn.
 *
 * With no credentials the agent does everything it does with them — builds the
 * post, renders the poster, saves the row, logs "queued Python Development" —
 * and then does not send it. Every log line looks like success, which is how a
 * company page can sit empty for a week while the logs say the job is running
 * perfectly. The only signal was a badge in the dashboard, and nobody opens the
 * dashboard to find out why nothing was posted.
 *
 * So the process says it plainly, once, at the point somebody is already
 * reading the log: when it starts.
 */
function announceReach() {
  let cfg = {};
  try {
    cfg = require('./linkedinClient').config() || {};
  } catch (e) {
    cfg = {};
  }

  if (cfg.configured) {
    console.log(`[linkedin-autopilot] posting as ${cfg.orgName || cfg.orgUrn} — posts will be live`);
    if (cfg.warning) console.warn(`[linkedin-autopilot] ${cfg.warning}`);
    return;
  }

  console.warn(
    '\n'
    + '  ┌─────────────────────────────────────────────────────────────────┐\n'
    + '  │  LinkedIn agent is in DRY RUN.                                  │\n'
    + '  │  It will build every post and send NONE of them.                │\n'
    + '  │                                                                 │\n'
    + '  │  No LINKEDIN_ACCESS_TOKEN + LINKEDIN_ORG_ID, and no page        │\n'
    + '  │  connected through OAuth.                                       │\n'
    + '  │                                                                 │\n'
    + '  │  Run:  node scripts/linkedin-status.js                          │\n'
    + '  └─────────────────────────────────────────────────────────────────┘\n',
  );
}

module.exports = { FIRST_TICK_MS, SLOT_HOURS, due, feed, forecast, imageUrlFor, readPoster, start, stats, tick };
