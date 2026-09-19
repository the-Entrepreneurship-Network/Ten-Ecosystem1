'use strict';

/**
 * The part of the LinkedIn agent that runs when nobody is watching.
 *
 * Two jobs, and they are less related than they look.
 *
 * `parseWhen` turns what a person typed — "tomorrow 10am", "monday 9am", "in
 * 2 hours", "25 Sep 18:00" — into a UTC instant. It is called from the chat
 * turn and from POST /posts/:id/schedule, and it is the only place in the
 * feature that reads a human time.
 *
 * `runDue` is the minute tick that publishes what has come due.
 *
 * Both are built around the same two facts about this deployment.
 *
 * 1. **Staff think in IST and the server does not.** The box runs under PM2 in
 *    whatever timezone the host was imaged with, usually UTC. If "tomorrow
 *    10am" were parsed with `new Date()`'s local calendar, a post scheduled at
 *    23:00 IST would land on the wrong day and go out 5.5 hours early — and it
 *    would be right on a developer's laptop in Kolkata, so nobody would
 *    reproduce it. Every calendar calculation below is therefore done by hand
 *    against a fixed +05:30. India has no daylight saving, which is what makes
 *    a fixed offset correct rather than merely convenient, and it is also why
 *    this does not reach for `Intl.DateTimeFormat` gymnastics.
 *
 * 2. **There is more than one worker.** PM2 runs several copies of this
 *    process, every one of them with its own cron tick firing at the same
 *    second. If the tick read the due posts and then published them, two
 *    workers would read the same post and the company page would get the same
 *    announcement twice. So a post is *claimed* with a single atomic
 *    findOneAndUpdate that flips 'scheduled' to 'publishing' — whichever
 *    worker's write lands first gets the document back, and the others get
 *    null and move on.
 */

const IST_MINUTES = 330;

/*
 * The timezones this understands. Anything else falls back to IST rather than
 * failing: every caller passes 'Asia/Kolkata', and a post scheduled in the
 * office's own timezone is a better wrong answer than no schedule at all.
 */
const OFFSET_MINUTES = {
  'asia/kolkata': IST_MINUTES,
  'asia/calcutta': IST_MINUTES,
  ist: IST_MINUTES,
  utc: 0,
  'etc/utc': 0,
  gmt: 0,
};

/* A date with no time attached means the morning slot, not midnight. Midnight
   would be both useless (nobody is on LinkedIn) and surprising: "schedule 25
   Sep" then goes out at 00:00 on the 25th, which reads as the 24th to anyone
   who was awake for it. */
const DEFAULT_HOUR = 10;

/* "tonight" with no hour. */
const EVENING_HOUR = 19;

/* Anything further out than this is a misparse, not a plan — a stray "2019"
   or a day/month swap can produce a date centuries away, and storing it means
   a post that silently never publishes. */
const MAX_AHEAD_MS = 2 * 365 * 24 * 60 * 60 * 1000;

/* How many due posts one tick will publish. The tick runs every minute, so a
   backlog drains quickly; the cap is there so a hundred posts that all came
   due during an outage cannot hold one worker for ten minutes. */
const MAX_PER_TICK = 5;

const MONTHS = {
  jan: 0, january: 0,
  feb: 1, february: 1,
  mar: 2, march: 2,
  apr: 3, april: 3,
  may: 4,
  jun: 5, june: 5,
  jul: 6, july: 6,
  aug: 7, august: 7,
  sep: 8, sept: 8, september: 8,
  oct: 9, october: 9,
  nov: 10, november: 10,
  dec: 11, december: 11,
};

const WEEKDAYS = {
  sunday: 0, sun: 0,
  monday: 1, mon: 1,
  tuesday: 2, tues: 2, tue: 2,
  wednesday: 3, weds: 3, wed: 3,
  thursday: 4, thurs: 4, thur: 4, thu: 4,
  friday: 5, fri: 5,
  saturday: 6, sat: 6,
};

/* Longest first, so "sunday" is not matched as "sun" with "day" left over. */
const WEEKDAY_RE = /\b(sunday|saturday|thursday|wednesday|tuesday|monday|friday|thurs|thur|tues|weds|sun|mon|tue|wed|thu|fri|sat)\b/;
const MONTH_RE = '(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sept|sep|oct|nov|dec)';

/* ── clock helpers ──────────────────────────────────────────────────────── */

function offsetMs(tz) {
  const key = String(tz || '').trim().toLowerCase();
  const minutes = Object.prototype.hasOwnProperty.call(OFFSET_MINUTES, key) ? OFFSET_MINUTES[key] : IST_MINUTES;
  return minutes * 60 * 1000;
}

/**
 * The calendar fields a person in that timezone would read off a wall clock.
 *
 * Done by shifting the instant and then reading the *UTC* fields: the getters
 * for local time would consult the host's timezone, which is exactly the thing
 * this module refuses to depend on.
 */
function localParts(date, off) {
  const shifted = new Date(date.getTime() + off);
  return {
    y: shifted.getUTCFullYear(),
    m: shifted.getUTCMonth(),
    d: shifted.getUTCDate(),
    h: shifted.getUTCHours(),
    mi: shifted.getUTCMinutes(),
    dow: shifted.getUTCDay(),
  };
}

/** A wall-clock moment in that timezone, as a UTC timestamp. */
function fromLocal(y, m, d, h, mi, off) {
  return Date.UTC(y, m, d, h, mi, 0, 0) - off;
}

/* ── parseWhen ──────────────────────────────────────────────────────────── */

/**
 * Pull a time of day out of the text and hand back what is left.
 *
 * Returns the hour and minute plus the remainder of the string, so the date
 * half can be parsed without tripping over the digits that belonged to the
 * clock — "18 Sep 10:00" has two numbers that both look like a day of the
 * month until the time is taken out first.
 */
function takeTime(text) {
  let m = text.match(/\b(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)(?![a-z])/);
  if (m) {
    const raw = parseInt(m[1], 10);
    if (raw >= 0 && raw <= 12) {
      let h = raw % 12;
      if (m[3].charAt(0) === 'p') h += 12;
      return { h, mi: m[2] ? parseInt(m[2], 10) : 0, rest: text.replace(m[0], ' ') };
    }
  }
  m = text.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
  if (m) return { h: parseInt(m[1], 10), mi: parseInt(m[2], 10), rest: text.replace(m[0], ' ') };
  if (/\bnoon\b/.test(text)) return { h: 12, mi: 0, rest: text.replace(/\bnoon\b/, ' ') };
  if (/\bmidnight\b/.test(text)) return { h: 0, mi: 0, rest: text.replace(/\bmidnight\b/, ' ') };
  return null;
}

/**
 * ISO first, on the original casing.
 *
 * A string that carries its own offset (…Z, …+05:30) is absolute and is taken
 * at face value. One without — "2026-09-25T10:00" — is a wall-clock time and
 * belongs to the caller's timezone, not to the server's, which is the whole
 * reason this is not a bare `new Date(s)`: `new Date('2026-09-25T10:00')`
 * means 10am in whatever timezone the host happens to be.
 */
function parseIso(text, off) {
  /* The fractional seconds are optional but must be allowed: an ISO string
     produced by Date.prototype.toISOString always carries ".000", so a
     pattern without it rejected the one timestamp format the browser and the
     API are most likely to send. */
  const m = text.match(/^(\d{4})-(\d{2})-(\d{2})(?:[t ](\d{1,2}):(\d{2})(?::(\d{2}))?(?:\.\d{1,6})?)?\s*(z|[+-]\d{2}:?\d{2})?$/i);
  if (!m) return null;
  if (m[7]) {
    const t = Date.parse(text);
    return Number.isNaN(t) ? null : t;
  }
  const y = parseInt(m[1], 10);
  const mo = parseInt(m[2], 10) - 1;
  const d = parseInt(m[3], 10);
  if (mo < 0 || mo > 11 || d < 1 || d > 31) return null;
  const h = m[4] == null ? DEFAULT_HOUR : parseInt(m[4], 10);
  const mi = m[5] == null ? 0 : parseInt(m[5], 10);
  if (h > 23 || mi > 59) return null;
  return fromLocal(y, mo, d, h, mi, off);
}

/** "in 2 hours", "in 30 minutes", "in 3 days", "in a week". */
function parseRelative(text, base) {
  const m = text.match(/^in\s+(a|an|\d{1,4})\s*(minute|minutes|min|mins|hour|hours|hr|hrs|day|days|week|weeks)\b/);
  if (!m) return null;
  const n = /^(a|an)$/.test(m[1]) ? 1 : parseInt(m[1], 10);
  if (!Number.isFinite(n) || n <= 0) return null;
  const unit = m[2];
  let ms = 0;
  if (/^min/.test(unit)) ms = n * 60 * 1000;
  else if (/^h/.test(unit)) ms = n * 60 * 60 * 1000;
  else if (/^d/.test(unit)) ms = n * 24 * 60 * 60 * 1000;
  else ms = n * 7 * 24 * 60 * 60 * 1000;
  return base.getTime() + ms;
}

/**
 * The calendar day the remaining words point at, as a UTC timestamp at the
 * hour and minute already extracted.
 *
 * Returns null when the words name no day at all *and* no time was given —
 * "make it snappy" is not a schedule, and guessing "today" for it would turn
 * an ordinary chat message into a scheduled post.
 */
function resolveDay(rest, base, off, h, mi, hadTime) {
  const p = localParts(base, off);
  const at = (y, m, d) => fromLocal(y, m, d, h, mi, off);

  if (/\bday after tomorrow\b/.test(rest)) return at(p.y, p.m, p.d + 2);
  if (/\b(tomorrow|tmrw|tmr)\b/.test(rest)) return at(p.y, p.m, p.d + 1);
  if (/\b(today|tonight|this evening)\b/.test(rest)) return at(p.y, p.m, p.d);

  const wd = rest.match(WEEKDAY_RE);
  if (wd) {
    const target = WEEKDAYS[wd[1]];
    let delta = (target - p.dow + 7) % 7;
    /* "next monday" said on a Monday means the one after this one. */
    if (delta === 0 && /\bnext\b/.test(rest)) delta = 7;
    let when = at(p.y, p.m, p.d + delta);
    /* "monday 9am" said on Monday at 10am means next Monday, not an hour ago. */
    if (when <= base.getTime()) when = at(p.y, p.m, p.d + delta + 7);
    return when;
  }

  /* 25/09, 25-09-2026, 25.9 — day first, the way it is written in India. */
  const slash = rest.match(/\b(\d{1,2})[/\-.](\d{1,2})(?:[/\-.](\d{2,4}))?\b/);
  if (slash) {
    const d = parseInt(slash[1], 10);
    const mo = parseInt(slash[2], 10) - 1;
    if (d >= 1 && d <= 31 && mo >= 0 && mo <= 11) {
      if (slash[3]) {
        const raw = parseInt(slash[3], 10);
        const y = raw < 100 ? 2000 + raw : raw;
        return at(y, mo, d);
      }
      return thisYearOrNext(p.y, mo, d, h, mi, off, base);
    }
  }

  /* "25 Sep", "25th September", "Sep 25". */
  const dayFirst = rest.match(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+${MONTH_RE}\\b(?:\\s+(\\d{4}))?`));
  if (dayFirst) {
    const d = parseInt(dayFirst[1], 10);
    const mo = MONTHS[dayFirst[2]];
    if (d >= 1 && d <= 31 && mo != null) {
      if (dayFirst[3]) return at(parseInt(dayFirst[3], 10), mo, d);
      return thisYearOrNext(p.y, mo, d, h, mi, off, base);
    }
  }
  const monthFirst = rest.match(new RegExp(`\\b${MONTH_RE}\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b(?:\\s+(\\d{4}))?`));
  if (monthFirst) {
    const mo = MONTHS[monthFirst[1]];
    const d = parseInt(monthFirst[2], 10);
    if (d >= 1 && d <= 31 && mo != null) {
      if (monthFirst[3]) return at(parseInt(monthFirst[3], 10), mo, d);
      return thisYearOrNext(p.y, mo, d, h, mi, off, base);
    }
  }

  /* A bare time and no day: today. If today's slot has gone, parseWhen turns
     that into null and the agent asks again rather than quietly moving it to
     tomorrow — "10am" typed at 2pm is ambiguous, and a post that goes out 20
     hours after it was scheduled is not what anybody meant. */
  if (hadTime) return at(p.y, p.m, p.d);
  return null;
}

/** A day/month with no year is the next one that has not happened yet. */
function thisYearOrNext(year, mo, d, h, mi, off, base) {
  const thisYear = fromLocal(year, mo, d, h, mi, off);
  if (thisYear > base.getTime()) return thisYear;
  return fromLocal(year + 1, mo, d, h, mi, off);
}

/**
 * Text in, a UTC Date out, or null.
 *
 * Null covers three different situations on purpose — unparseable, in the
 * past, and absurdly far away — because the caller says the same thing to all
 * three ("I couldn't read that as a future time") and any of them silently
 * becoming a stored `scheduledFor` is a post that either fires immediately or
 * never fires at all.
 */
function parseWhen(text, now, tz) {
  const off = offsetMs(tz === undefined ? 'Asia/Kolkata' : tz);
  const base = (now instanceof Date && !Number.isNaN(now.getTime())) ? now : new Date();
  const original = String(text == null ? '' : text).trim();
  if (!original) return null;

  const iso = parseIso(original, off);
  if (iso != null) return future(iso, base);

  let s = original.toLowerCase();
  /* The route hands over just the time phrase, but the chat turn can pass the
     whole message, so the leading verb and its filler words are stripped. */
  s = s
    .replace(/^(?:schedule|publish|post)\b\s*/, '')
    .replace(/^(?:it|this|that)\b\s*/, '')
    .replace(/^(?:for|on|at)\b\s*/, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!s) return null;

  const rel = parseRelative(s, base);
  if (rel != null) return future(rel, base);

  const time = takeTime(s);
  const hadTime = Boolean(time);
  const rest = (time ? time.rest : s).replace(/,/g, ' ').replace(/\s+/g, ' ').trim();
  const h = time ? time.h : (/\b(tonight|this evening)\b/.test(rest) ? EVENING_HOUR : DEFAULT_HOUR);
  const mi = time ? time.mi : 0;

  const day = resolveDay(rest, base, off, h, mi, hadTime);
  if (day == null) return null;
  return future(day, base);
}

function future(ms, base) {
  if (!Number.isFinite(ms)) return null;
  const delta = ms - base.getTime();
  if (delta <= 0) return null;
  if (delta > MAX_AHEAD_MS) return null;
  return new Date(ms);
}

/* ── the tick ───────────────────────────────────────────────────────────── */

/*
 * Required lazily, and injectable, for the same reason the agent does it: the
 * unit tests must be able to run this loop with no mongoose and no LinkedIn
 * client, and requiring either at the top of the file would load the whole
 * model layer just to parse "tomorrow 10am".
 */
function resolveDeps(deps) {
  const given = deps || {};
  return {
    LinkedInPost: given.LinkedInPost || require('../../../models/LinkedInPost'),
    linkedinClient: given.linkedinClient || require('./linkedinClient'),
  };
}

function historyEntry(action, note) {
  return { at: new Date(), by: 'scheduler', action, note: String(note || '').slice(0, 300) };
}

/**
 * Take ownership of one due post, atomically.
 *
 * The filter and the update are one operation on purpose: MongoDB applies the
 * update to a document that still matches the filter, so of two workers
 * racing on the same post exactly one sees status 'scheduled' and gets the
 * document back. Reading first and updating second would let both workers see
 * 'scheduled' and both publish — the duplicate-post bug this whole design
 * exists to prevent.
 */
async function claim(d, now) {
  const doc = await d.LinkedInPost.findOneAndUpdate(
    { status: 'scheduled', scheduledFor: { $lte: now } },
    {
      $set: { status: 'publishing' },
      $push: { history: historyEntry('publishing', 'claimed by the scheduler') },
    },
    { new: true, sort: { scheduledFor: 1 } },
  );
  return doc || null;
}

async function record(d, id, set, action, note) {
  try {
    await d.LinkedInPost.findByIdAndUpdate(id, {
      $set: set,
      $push: { history: historyEntry(action, note) },
    });
  } catch (e) {
    console.error('[linkedin-scheduler] could not record the outcome:', e.message);
  }
}

/**
 * Publish one claimed post. Returns true when it counted as published — which
 * includes a dry run, because a dry run is the configured behaviour of a
 * server with no token and marking it 'failed' would fill the dashboard with
 * red for something that is working as designed.
 */
async function publishOne(d, post) {
  const id = post._id != null ? post._id : post.id;
  const text = post.final || '';

  /* A post whose text was blocked, or that lost its text somewhere, must not
     go out — the scheduler is the one publish path with no human in front of
     it, so it re-checks what the chat turn already checked. */
  if (!text || post.verdict === 'block') {
    await record(d, id, { status: 'failed', error: 'no approved text to publish' }, 'failed', 'no approved text');
    return false;
  }

  /*
   * The poster PNG is rasterised in the browser and stored on the post,
   * because there is no canvas on the server: whatever the person saw in the
   * preview is what goes out, or nothing does. A scheduled post with no
   * stored PNG goes out as text rather than not at all.
   */
  const wantsImage = !post.poster || post.poster.withImage !== false;
  let png;
  if (wantsImage && post.poster && post.poster.png) {
    try {
      const buf = Buffer.from(post.poster.png, 'base64');
      if (buf.length) png = buf;
    } catch (e) {
      png = undefined;
    }
  }

  let result;
  try {
    result = await d.linkedinClient.publish({ text, png });
  } catch (e) {
    /* publish() promises never to throw; if it ever does, the post must still
       land in a final state rather than sit in 'publishing' forever. */
    result = { ok: false, error: e && e.message ? e.message : 'publish threw' };
  }
  const r = result || { ok: false, error: 'no response from the LinkedIn client' };

  if (r.ok || r.dryRun) {
    await record(d, id, {
      status: 'published',
      publishedAt: new Date(),
      dryRun: Boolean(r.dryRun),
      linkedin: { postUrn: r.postUrn || '', imageUrn: r.imageUrn || '', url: r.url || '' },
      error: '',
    }, r.dryRun ? 'dry-run' : 'published', r.url || '');
    return true;
  }

  await record(d, id, {
    status: 'failed',
    error: String(r.error || 'LinkedIn refused the post').slice(0, 500),
  }, 'failed', r.error || '');
  return false;
}

/**
 * One tick: claim and publish everything that has come due.
 *
 * Never throws. It is called from a cron callback where there is nobody to
 * catch anything — an unhandled rejection inside a node-cron task takes the
 * whole process down under PM2, which would stop the portal serving pages
 * because a LinkedIn post failed.
 */
async function runDue(now, deps) {
  const at = (now instanceof Date && !Number.isNaN(now.getTime())) ? now : new Date();
  const d = resolveDeps(deps);
  const out = { published: 0, failed: 0 };

  for (let i = 0; i < MAX_PER_TICK; i += 1) {
    let post = null;
    try {
      post = await claim(d, at);
    } catch (e) {
      console.error('[linkedin-scheduler] could not claim a due post:', e.message);
      break;
    }
    if (!post) break;
    let ok = false;
    try {
      ok = await publishOne(d, post);
    } catch (e) {
      console.error('[linkedin-scheduler] publishing a due post failed:', e.message);
      ok = false;
    }
    if (ok) out.published += 1;
    else out.failed += 1;
  }

  return out;
}

/* ── cron ───────────────────────────────────────────────────────────────── */

let task = null;
let running = false;

/**
 * Start the minute tick.
 *
 * Off under NODE_ENV=test and under LINKEDIN_SCHEDULER_DISABLED. The test
 * guard is not politeness: a cron task registered during a Jest run keeps an
 * interval alive, the run never exits, and CI hangs until it is killed.
 *
 * The `running` flag skips a tick while the previous one is still going. An
 * image upload plus a poll loop can take longer than a minute, and without
 * the flag a slow tick and the next one would both claim work — the claim is
 * atomic so nothing would be posted twice, but the process would stack up
 * overlapping runs it never catches up from.
 */
/*
 * How long after boot the first sweep runs.
 *
 * A few seconds behind the autopilot's own first tick, so that on a fresh
 * deploy the post it queues is picked up by this sweep rather than waiting for
 * the next minute edge. That ordering is why the number is what it is; it is
 * not a magic delay. If the autopilot has not finished, nothing is due and the
 * sweep is a no-op, and the minute tick catches it moments later.
 */
const FIRST_SWEEP_MS = 15 * 1000;

let firstTimer = null;

/** One sweep, guarded so two overlapping runs cannot both claim a post. */
function sweep() {
  if (running) return Promise.resolve();
  running = true;
  return Promise.resolve()
    .then(() => runDue(new Date()))
    .then((res) => {
      if (res && (res.published || res.failed)) {
        console.log(`[linkedin-scheduler] published ${res.published}, failed ${res.failed}`);
      }
    })
    .catch((e) => { console.error('[linkedin-scheduler] tick failed:', e && e.message ? e.message : e); })
    .then(() => { running = false; });
}

function start() {
  if (process.env.NODE_ENV === 'test') return null;
  if (process.env.LINKEDIN_SCHEDULER_DISABLED) return null;
  if (task) return task;

  /* Required here rather than at the top so that loading this module for
     parseWhen alone — which is what the route does — does not pull in cron. */
  const cron = require('node-cron');
  task = cron.schedule('* * * * *', () => { sweep(); });

  /* One sweep shortly after start-up, so the post the autopilot queues on
     boot goes out in seconds rather than at the next minute edge. The claim
     is atomic, so a worker that sweeps early cannot take a post twice. */
  firstTimer = setTimeout(() => { sweep(); }, FIRST_SWEEP_MS);
  if (firstTimer && typeof firstTimer.unref === 'function') firstTimer.unref();

  console.log('[linkedin-scheduler] scheduled posts will be published every minute');
  return task;
}

module.exports = { FIRST_SWEEP_MS, start, runDue, parseWhen };
