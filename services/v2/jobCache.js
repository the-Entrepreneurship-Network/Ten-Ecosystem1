'use strict';

/**
 * @fileoverview The agent's memory of every opening it has seen.
 *
 * Two reasons this exists, both from the field. A student asked for the
 * postings from earlier hunts, not only this hour's — an opening seen
 * yesterday is still an opening, and a resolved direct employer link is worth
 * keeping. And production showed all six boards failing at once (blocked
 * egress, rate limits, an outage — from the response it is all the same), at
 * which point the agent answered "0 openings" while sitting on everything it
 * had ever fetched.
 *
 * So every hunt feeds this cache, and every hunt reads it back: live rows
 * first, remembered rows after them, each marked with when it was seen.
 * When the boards are unreachable, the memory IS the answer — labelled as
 * memory, never passed off as fresh.
 *
 * A JSON file, deliberately. The repo's Mongo is authoritative for user data;
 * this is a disposable working set with a hard cap, and a file survives a
 * database outage — which is precisely the kind of day it exists for.
 * ponytail: single-process file cache; move to a collection if the portal
 * ever runs multi-instance.
 */

const fs = require('fs');
const path = require('path');

const CACHE_PATH = process.env.JOB_CACHE_PATH ||
  path.join(__dirname, '..', '..', 'data', 'job-cache.json');

const MAX_ENTRIES = 500;
const MAX_AGE_DAYS = 30; /* a posting older than this is presumed filled */

/* Only board facts and the resolved link are remembered. Fit and ATS scores
   are per-resume and are recomputed for whoever is asking. */
const KEEP = ['source', 'title', 'company', 'location', 'type', 'tags', 'url',
  'applyUrl', 'posted', 'description', 'directUrl', 'directKind', 'jobId'];

const keyOf = (job) => `${job.title}|${job.company}`.toLowerCase();

function load() {
  try {
    const raw = fs.readFileSync(CACHE_PATH, 'utf8');
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : [];
  } catch (e) {
    return []; /* first run, or a corrupt file — either way, an empty memory */
  }
}

function persist(entries) {
  try {
    fs.mkdirSync(path.dirname(CACHE_PATH), { recursive: true });
    /* Write-then-rename so a crash mid-write cannot corrupt the memory. */
    const tmp = CACHE_PATH + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(entries));
    fs.renameSync(tmp, CACHE_PATH);
  } catch (e) { /* a cache that cannot write is a cache, not an error */ }
}

const fresh = (entry) =>
  Date.now() - new Date(entry.fetchedAt || 0).getTime() < MAX_AGE_DAYS * 86400000;

/**
 * Remember this hunt's rows. New listings join, known listings are refreshed
 * in place — a direct link resolved today upgrades yesterday's entry.
 */
function remember(jobs) {
  if (!Array.isArray(jobs) || !jobs.length) return;
  const now = new Date().toISOString();
  const existing = load().filter(fresh);
  const byKey = new Map(existing.map((e) => [keyOf(e), e]));

  jobs.forEach((job) => {
    if (!job || !job.title || !job.url) return;
    const slim = {};
    KEEP.forEach((k) => { if (job[k] !== undefined) slim[k] = job[k]; });
    const prior = byKey.get(keyOf(slim));
    slim.fetchedAt = prior ? prior.fetchedAt : now;
    slim.refreshedAt = now;
    /* Never let a failed resolution erase a link a better day found. */
    if (!slim.directUrl && prior && prior.directUrl) {
      slim.directUrl = prior.directUrl;
      slim.directKind = prior.directKind;
    }
    byKey.set(keyOf(slim), slim);
  });

  persist([...byKey.values()]
    .sort((a, b) => new Date(b.refreshedAt) - new Date(a.refreshedAt))
    .slice(0, MAX_ENTRIES));
}

/**
 * Everything remembered that this hunt has not already found live.
 * Marked fromCache with the day it was first seen — the reader decides what
 * a five-day-old opening is worth, not the cache.
 */
function recall(excludeKeys) {
  const exclude = excludeKeys || new Set();
  return load()
    .filter(fresh)
    .filter((e) => !exclude.has(keyOf(e)))
    .map((e) => ({
      ...e,
      fromCache: true,
      seenDaysAgo: Math.max(0, Math.floor((Date.now() - new Date(e.fetchedAt).getTime()) / 86400000))
    }));
}

module.exports = { remember, recall, keyOf, CACHE_PATH, MAX_ENTRIES, MAX_AGE_DAYS };
