'use strict';

/**
 * The weekend autopilot: the part of this feature that runs with nobody
 * logged in.
 *
 * Every Saturday and every Sunday the company page gets one hiring post, for
 * one of the fourteen domains, with that domain's poster attached and that
 * domain's application link in the text. No staff member types anything, opens
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
 * **One row per slot, enforced by the database.** The tick runs every ten
 * minutes on every worker, so it will try to queue the same Saturday dozens of
 * times. `slot` is uniquely indexed, so the first insert wins and the rest come
 * back as a duplicate-key error which is caught and treated as success —
 * "somebody already queued this" is the normal outcome, not a fault.
 *
 * **The text is checked even though the text is ours.** contentGuard runs on
 * every generated body before it is saved. It should never fire, because the
 * body comes from a constant. That is exactly why it is cheap to keep: the day
 * somebody edits weekendPost.js and slips in a phone number or a stipend
 * figure, the guard catches it before the page does.
 */

const fs = require('fs');
const path = require('path');

const weekendPost = require('./weekendPost');

/*
 * Posters live on disk as finished JPEGs rather than being drawn at post time.
 *
 * Drawing them here would mean a headless browser on the production box, at
 * ten past ten on a Saturday, with nobody watching it fail. The poster for a
 * domain does not change between weekends — the facts on it are the programme
 * constants — so it is rendered once by poster-kit, committed, and read as
 * bytes. A missing file costs the post its image and nothing else.
 */
const POSTER_DIR = path.join(__dirname, '..', '..', '..', 'public', 'assets', 'linkedin-posters');

/* The hour, IST, the weekend post goes out. Late morning: early enough to run
   through the day, late enough that it is not sitting at the bottom of the
   feed by the time anybody is awake. */
const SLOT_HOUR = 10;

/* How long after the slot hour the tick will still queue a missed post. A
   process that was down from Saturday morning to Saturday evening should still
   post on Saturday; one that comes back on Tuesday should not post Saturday's
   opening three days late, so the window closes at the end of the day. */
const SLOT_WINDOW_HOURS = 12;

function resolveDeps(deps) {
  const given = deps || {};
  return {
    LinkedInPost: given.LinkedInPost || require('../../../models/LinkedInPost'),
    guard: given.guard || require('./contentGuard'),
    weekend: given.weekend || weekendPost,
    readPoster: given.readPoster || readPoster,
    now: given.now,
  };
}

/**
 * The poster bytes for a domain, or undefined.
 *
 * Undefined rather than throwing: a post with no image is a post, and the
 * alternative — a weekend with no hiring post because a JPEG was missing — is
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
 * Should a post be queued for this instant, and for which slot?
 *
 * Returns `{ ok: false, reason }` far more often than not — the tick runs
 * every ten minutes and only two of those runs a week do anything.
 */
function due(now) {
  const at = (now instanceof Date && !Number.isNaN(now.getTime())) ? now : new Date();
  if (!weekendPost.isWeekend(at)) return { ok: false, reason: 'not a weekend' };

  const hour = weekendPost.istDay(at).h;
  if (hour < SLOT_HOUR) return { ok: false, reason: `before the ${SLOT_HOUR}:00 IST slot` };
  if (hour >= SLOT_HOUR + SLOT_WINDOW_HOURS) return { ok: false, reason: 'the slot for today has closed' };

  return { ok: true, at, key: `weekend:${weekendPost.istDateKey(at)}` };
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

  const domain = d.weekend.pick(slot.at);
  const text = d.weekend.body(domain);
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
      template: 'weekend-hiring',
      fields: { domain: domain.name, role: domain.role, alt: d.weekend.altText(domain) },
      svg: '',
      png: png ? png.toString('base64') : '',
      withImage: Boolean(png),
    },
    status: 'scheduled',
    scheduledFor: slot.at,
    author: { role: 'system', id: 'autopilot', name: 'Weekend autopilot' },
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
       earlier run of this one, already queued today. */
    if (e && (e.code === 11000 || e.code === 11001)) {
      return { queued: false, reason: 'already queued for this slot', slot: slot.key };
    }
    console.error('[linkedin-autopilot] could not queue the weekend post:', e && e.message ? e.message : e);
    return { queued: false, reason: 'save failed', error: e && e.message ? e.message : String(e) };
  }
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
    schedule: { hour: SLOT_HOUR, days: ['Saturday', 'Sunday'], timezone: 'Asia/Kolkata' },
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
  const want = Math.max(1, Math.min(14, parseInt(count, 10) || 4));
  const out = [];
  /* Walk forward a day at a time and keep the weekends. Two months of days is
     far more than enough to find fourteen weekend slots. */
  for (let i = 0; i < 70 && out.length < want; i += 1) {
    const day = new Date(at.getTime() + i * 86400000);
    if (!weekendPost.isWeekend(day)) continue;
    const key = weekendPost.istDateKey(day);
    /* Today only counts if its slot has not already closed. */
    if (i === 0 && !due(at).ok) continue;
    const domain = weekendPost.pick(day);
    out.push({ date: key, domain: domain.name, role: domain.role });
  }
  return out;
}

/* ── cron ───────────────────────────────────────────────────────────────── */

let task = null;
let running = false;

/**
 * Start the ten-minute check.
 *
 * Ten minutes rather than once a week at 10:00 sharp: a weekly cron that fires
 * while the box is restarting misses the slot entirely and nobody notices
 * until Monday. A repeating check that is a no-op 1006 times out of 1008 costs
 * nothing and heals itself.
 *
 * Off under NODE_ENV=test for the same reason as the scheduler — a registered
 * cron task keeps the Jest run alive and CI hangs.
 */
function start() {
  if (process.env.NODE_ENV === 'test') return null;
  if (process.env.LINKEDIN_AUTOPILOT_DISABLED) return null;
  if (task) return task;

  const cron = require('node-cron');
  task = cron.schedule('*/10 * * * *', () => {
    if (running) return;
    running = true;
    Promise.resolve()
      .then(() => tick(new Date()))
      .catch((e) => { console.error('[linkedin-autopilot] tick failed:', e && e.message ? e.message : e); })
      .then(() => { running = false; });
  });
  console.log(`[linkedin-autopilot] a hiring post will be queued every Saturday and Sunday at ${SLOT_HOUR}:00 IST`);
  return task;
}

module.exports = { SLOT_HOUR, SLOT_WINDOW_HOURS, due, forecast, readPoster, start, stats, tick };
