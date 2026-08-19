'use strict';
const { httpFetch } = require('./httpFetch');

/**
 * @fileoverview Company ATS boards — openings straight from the employer.
 *
 * The capability the job-hunter-toolkit repo is built around, and the answer
 * to the complaint this portal kept failing: "give me the link to the job,
 * not to the platform". Greenhouse, Lever and Ashby each publish a public
 * JSON board per company, and every row they return carries the employer's
 * own apply URL. There is nothing to resolve, nothing to scrape, no login
 * anywhere — the direct link is the data.
 *
 * It also answers the other failure the recordings showed: when every
 * aggregator is unreachable, these boards are a different set of hosts and
 * usually still answer. A portal that could not find a single opening was
 * asking four sites that were all blocked.
 *
 * The company list is the honest limit. Nobody can enumerate every employer
 * on earth, so this ships a curated roster — Indian product companies,
 * global names that hire from India, and remote-first firms — and treats it
 * as a starting point rather than a claim of completeness.
 */

const UA = { 'User-Agent': 'TEN-JobAgent/1.0 (+https://entrepreneurshipnetwork.net)' };

/*
 * Boards worth asking, by ATS. Slugs are the company's handle on that ATS,
 * which is not always its brand name — they are verified by the probe script
 * rather than guessed, and a 404 simply drops out of the results.
 */
const BOARDS = Object.freeze({
  greenhouse: [
    'stripe', 'databricks', 'airbnb', 'dropbox', 'robinhood', 'doordash',
    'figma', 'gitlab', 'cloudflare', 'twilio', 'asana', 'brex', 'plaid',
    'affirm', 'coinbase', 'instacart', 'reddit', 'discord', 'anthropic',
    'openai', 'scaleai', 'canva', 'atlassian', 'zscaler', 'hubspot',
  ],
  lever: [
    'palantir', 'ramp', 'attentive', 'mistral', 'plaid', 'welocalize',
    'kraken', 'brave', 'sardine', 'huntress', 'veeva',
  ],
  ashby: [
    'ramp', 'linear', 'vanta', 'deel', 'posthog', 'clerk', 'replit',
    'supabase', 'render', 'warp', 'browserbase', 'together',
  ],
});

async function getJSON(url, ms) {
  const res = await httpFetch(url, { headers: UA, timeoutMs: ms || 7000 });
  if (!res.ok) throw new Error(String(res.status));
  return res.json();
}

const clean = (s) => String(s || '').replace(/<[^>]*>/g, ' ').replace(/&[a-z#0-9]+;/gi, ' ')
  .replace(/\s+/g, ' ').trim();

/** Greenhouse: `boards-api.greenhouse.io/v1/boards/<slug>/jobs`. */
async function fromGreenhouse(slug, opts) {
  const data = await getJSON(`https://boards-api.greenhouse.io/v1/boards/${slug}/jobs?content=true`, opts && opts.timeoutMs);
  return (data.jobs || []).map((j) => ({
    source: 'Greenhouse',
    company: slug,
    title: clean(j.title),
    location: clean(j.location && j.location.name),
    type: 'Full-time',
    tags: [],
    /* The employer's own posting — the whole point of this source. */
    url: j.absolute_url,
    directUrl: j.absolute_url,
    directKind: 'ats',
    posted: j.updated_at || j.first_published || null,
    description: clean(j.content).slice(0, 4000),
  }));
}

/** Lever: `api.lever.co/v0/postings/<slug>?mode=json`. */
async function fromLever(slug, opts) {
  const data = await getJSON(`https://api.lever.co/v0/postings/${slug}?mode=json`, opts && opts.timeoutMs);
  return (Array.isArray(data) ? data : []).map((j) => ({
    source: 'Lever',
    company: slug,
    title: clean(j.text),
    location: clean(j.categories && j.categories.location),
    type: clean(j.categories && j.categories.commitment) || 'Full-time',
    tags: [clean(j.categories && j.categories.team)].filter(Boolean),
    url: j.hostedUrl || j.applyUrl,
    directUrl: j.hostedUrl || j.applyUrl,
    directKind: 'ats',
    posted: j.createdAt ? new Date(j.createdAt).toISOString() : null,
    description: clean(j.descriptionPlain || j.description).slice(0, 4000),
  }));
}

/** Ashby: `api.ashbyhq.com/posting-api/job-board/<slug>`. */
async function fromAshby(slug, opts) {
  const data = await getJSON(`https://api.ashbyhq.com/posting-api/job-board/${slug}`, opts && opts.timeoutMs);
  return (data.jobs || []).map((j) => ({
    source: 'Ashby',
    company: clean(j.companyName) || slug,
    title: clean(j.title),
    location: clean(j.location),
    type: clean(j.employmentType) || 'Full-time',
    tags: [clean(j.department), clean(j.team)].filter(Boolean),
    url: j.jobUrl || j.applyUrl,
    directUrl: j.jobUrl || j.applyUrl,
    directKind: 'ats',
    posted: j.publishedAt || null,
    description: clean(j.descriptionPlain).slice(0, 4000),
  }));
}

const FETCHERS = { greenhouse: fromGreenhouse, lever: fromLever, ashby: fromAshby };

/**
 * Ask a slice of the roster and return everything that matched the profile.
 *
 * Boards are asked in parallel batches inside a budget, because a person is
 * watching a spinner: a slow company must cost its own row, not the hunt. A
 * 404 is a slug that moved or a board that closed — dropped without comment,
 * since a missing company is not an error the student can act on.
 */
async function huntBoards(matches, options) {
  const opts = options || {};
  const deadline = Date.now() + (opts.budgetMs || 9000);
  const perBoard = opts.perBoard || 6;

  /* A rotating window keeps every hunt from asking the same first companies,
     so the roster is covered across sessions rather than only its head. */
  const offset = opts.offset || 0;
  const targets = [];
  Object.entries(BOARDS).forEach(([ats, slugs]) => {
    const take = Math.min(perBoard, slugs.length);
    for (let i = 0; i < take; i++) targets.push({ ats, slug: slugs[(offset + i) % slugs.length] });
  });

  const found = [];
  const BATCH = 6;
  for (let i = 0; i < targets.length; i += BATCH) {
    if (Date.now() > deadline) break;
    await Promise.all(targets.slice(i, i + BATCH).map(async (t) => {
      try {
        const rows = await FETCHERS[t.ats](t.slug, { timeoutMs: 5000 });
        rows.forEach((r) => { if (!matches || matches(r)) found.push(r); });
      } catch (e) { /* 404 or slow board — it simply contributes nothing */ }
    }));
  }
  return found;
}

module.exports = { huntBoards, fromGreenhouse, fromLever, fromAshby, BOARDS };
