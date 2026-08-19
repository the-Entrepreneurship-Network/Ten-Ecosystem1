'use strict';

/**
 * @fileoverview Direct opening URLs — the job-hunt-agent skill's url-rules.md
 * as code.
 *
 * The rule this file exists to enforce: a link the student clicks must land
 * on the job itself — the employer's careers page or their ATS posting — not
 * on the aggregator that happened to list it. If Unstop wraps a Google
 * opening, the link the student gets is Google's page, not Unstop's.
 *
 * Two mechanisms, both deterministic:
 *
 *   Redirect capture — many board apply URLs 302 straight to the employer's
 *   ATS. Following the redirect and keeping the final URL costs nothing and
 *   is already proof the destination exists.
 *
 *   Page resolution — when the board URL serves its own page, that page's
 *   HTML almost always carries the outbound apply link. One fetch, one scan
 *   for accept-listed hosts, prefer the ATS. No login, no crawling: one
 *   public page the student would have opened anyway.
 *
 * When neither yields an employer page, the board's own JOB url (with an id)
 * is kept and labelled `via <board>`, exactly as the skill's resolve chain
 * step 5 instructs — and never a search query: a Google SERP is not an
 * opening.
 */

/* Hosts from the skill's accept list. A link on one of these is the job. */
const ATS_HOSTS = [
  'boards.greenhouse.io', 'greenhouse.io',
  'jobs.lever.co', 'lever.co',
  'jobs.ashbyhq.com', 'ashbyhq.com',
  'myworkdayjobs.com',
  'jobs.smartrecruiters.com', 'smartrecruiters.com',
  'icims.com',
  'bamboohr.com',
  'workable.com',
  'jobvite.com',
  'recruitee.com',
  'teamtailor.com',
  'breezy.hr',
];

/* The boards themselves. A final URL still on one of these is not direct. */
const AGGREGATOR_HOSTS = [
  'remotive.com', 'remoteok.com', 'arbeitnow.com', 'news.ycombinator.com',
  'jobicy.com', 'himalayas.app', 'linkedin.com', 'naukri.com', 'indeed.com',
  'unstop.com', 'internshala.com', 'glassdoor.com', 'foundit.in', 'shine.com',
  'timesjobs.com', 'wellfound.com', 'instahyre.com', 'cutshort.io', 'hirist.tech',
  'google.com', 'upwork.com', 'fiverr.com', 'freelancer.com', 'weworkremotely.com',
];

const hostOf = (url) => {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch (e) { return ''; }
};

/*
 * Matching by whole domain missed TLD twins: arbeitnow.co.uk sailed past a
 * list that only knew arbeitnow.com and got labelled a company site. A brand
 * is a brand on any TLD, so hosts match when they share a registrable label
 * with a listed one.
 */
const brandOf = (domain) => String(domain).split('.')[0];

const onList = (host, list) => {
  const labels = String(host).split('.');
  return list.some((h) => {
    if (host === h || host.endsWith('.' + h)) return true;
    const brand = brandOf(h);
    return brand.length > 3 && labels.includes(brand);
  });
};

function isAts(url) { return onList(hostOf(url), ATS_HOSTS); }
function isAggregator(url) { return onList(hostOf(url), AGGREGATOR_HOSTS); }

/** A search results page is never an opening — the skill's reject list. */
function isSearchPage(url) {
  return /[?&]q=|\/search\b|google\.[a-z.]+\/search/.test(String(url));
}

/**
 * Classify a URL the way the table column needs it:
 * 'ats' and 'company' are direct; 'board' is `via <source>`; null is unusable.
 */
function classify(url) {
  if (!url || isSearchPage(url)) return null;
  if (isAts(url)) return 'ats';
  if (!isAggregator(url)) return 'company';
  return 'board';
}

/**
 * Scan one board page's HTML for the outbound apply link.
 *
 * ATS hosts win over plain company domains, and the reject rules apply to
 * every candidate: no search pages, no aggregator cross-links, no login
 * walls pretending to be applications.
 */
function extractApplyLink(html, boardUrl) {
  const urls = String(html || '').match(/https?:\/\/[^\s"'<>()\\]+/g) || [];
  const boardHost = hostOf(boardUrl);

  const candidates = urls
    .map((u) => u.replace(/[.,;)\]}"']+$/, ''))
    .filter((u) => {
      const h = hostOf(u);
      if (!h || h === boardHost) return false;
      if (isSearchPage(u)) return false;
      if (/login|signin|signup|account|auth/.test(u)) return false;
      return true;
    });

  const ats = candidates.find(isAts);
  if (ats) return { url: ats, kind: 'ats' };

  /* A careers path on a non-aggregator host is the employer's own page. */
  const company = candidates.find((u) =>
    !isAggregator(u) && /careers?|jobs?|positions?|openings?|vacanc/i.test(u) &&
    /[/-][a-z0-9-]{4,}/i.test(new URL(u).pathname));
  if (company) return { url: company, kind: 'company' };

  return null;
}

/**
 * Resolve one listing to its direct opening URL.
 *
 * Order matters and is cheapest-first: the redirect a HEAD already followed,
 * then one GET of the board page. Failure is an honest null — the caller
 * keeps the board's job URL labelled `via <board>`, never a search query.
 */
async function resolveDirectUrl(job, options) {
  const opts = options || {};
  const fetcher = opts.fetch || fetch;

  if (classify(job.url) === 'ats' || classify(job.url) === 'company') {
    return { url: job.url, kind: classify(job.url) };
  }

  /* The listing's own text first — an HN hiring post usually carries its
     Greenhouse or Lever link in the body. Zero network, highest precision. */
  if (job.description) {
    const inText = extractApplyLink(job.description, job.url);
    if (inText) return inText;
  }

  /* A board that publishes a separate apply URL is handing us the redirect:
     follow that one, it is the link that actually leaves the board. */
  const target = job.applyUrl && classify(job.applyUrl) !== null ? job.applyUrl : job.url;

  try {
    const res = await fetcher(target, {
      headers: { 'User-Agent': 'TEN-JobAgent/1.0 (+https://entrepreneurshipnetwork.net)' },
      redirect: 'follow',
      signal: AbortSignal.timeout(opts.timeoutMs || 6000),
    });

    /* Redirect capture: the request may already have left the board. */
    if (res.url && hostOf(res.url) !== hostOf(target)) {
      const kind = classify(res.url);
      if (kind === 'ats' || kind === 'company') return { url: res.url, kind };
    }

    if (res.ok) {
      const html = await res.text();
      const found = extractApplyLink(html, target);
      if (found) return found;
    }
  } catch (e) { /* unreachable page — the board link stands, labelled */ }

  return null;
}

/**
 * Resolve a batch inside a time budget. Whatever the budget cannot reach
 * stays a labelled board link — a slow employer site must not stall the hunt.
 */
async function resolveBatch(jobs, options) {
  const opts = options || {};
  const deadline = Date.now() + (opts.budgetMs || 12000);
  const SIZE = 4;

  for (let i = 0; i < jobs.length; i += SIZE) {
    if (Date.now() > deadline) break;
    await Promise.all(jobs.slice(i, i + SIZE).map(async (job) => {
      const direct = await resolveDirectUrl(job, opts);
      if (direct) {
        job.directUrl = direct.url;
        job.directKind = direct.kind; /* 'ats' | 'company' */
      }
    }));
  }
  return jobs;
}

module.exports = {
  resolveDirectUrl, resolveBatch, extractApplyLink, classify,
  isAts, isAggregator, isSearchPage, ATS_HOSTS, AGGREGATOR_HOSTS,
};
