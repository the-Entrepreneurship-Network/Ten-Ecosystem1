'use strict';

const { httpFetch } = require('./httpFetch');

/**
 * A student's public GitHub, read into resume facts.
 *
 * Asked for projects, most people freeze — the work exists, they just cannot
 * summon it in a chat box. It is already written down: repositories they own,
 * with a description, a language, a size and a date. Reading those turns the
 * hardest question in the interview into a list to confirm.
 *
 * Only the public API, and only what a signed-out visitor could see. No token,
 * no login, no scraping of the profile page. A private repository is invisible
 * here and stays that way.
 */

const API = 'https://api.github.com';

/** The username out of whatever they pasted — URL, @handle, or bare name. */
function usernameFrom(input) {
  const raw = String(input || '').trim();
  if (!raw) return null;
  const url = raw.match(/github\.com\/([A-Za-z0-9-]{1,39})/i);
  if (url) return url[1];
  const bare = raw.replace(/^@/, '').match(/^([A-Za-z0-9-]{1,39})$/);
  return bare ? bare[1] : null;
}

/*
 * Forks and empty scaffolds are not projects.
 *
 * A profile is mostly other people's code: tutorial forks, a dotfiles repo, an
 * untouched create-react-app. Putting those on a resume is worse than an empty
 * projects section, because an interviewer opens one and finds nothing the
 * candidate wrote.
 */
function worthListing(repo) {
  if (repo.fork || repo.archived || repo.private) return false;
  if (!repo.description && repo.size < 100) return false;   /* empty scaffold */
  if (/^(dotfiles|config|test|demo|hello-world|playground|practice|tutorial)/i.test(repo.name || '')) return false;
  return true;
}

/** A repo as a resume bullet — its own words, never ours. */
function asBullet(repo) {
  const name = String(repo.name || '').replace(/[-_]+/g, ' ').trim();
  const parts = [];
  if (repo.description) parts.push(String(repo.description).replace(/\.$/, ''));
  const built = [repo.language, ...(repo.topics || []).slice(0, 3)].filter(Boolean);
  if (built.length) parts.push(`Built with ${[...new Set(built)].join(', ')}`);
  /* Stars are the only public number, and only when there are enough of them
     to mean anything. Two stars is not a metric, it is two friends. */
  if (repo.stargazers_count >= 5) parts.push(`${repo.stargazers_count} stars on GitHub`);
  return {
    name,
    url: repo.html_url,
    updated: repo.pushed_at ? String(repo.pushed_at).slice(0, 7) : null,
    language: repo.language || null,
    topics: repo.topics || [],
    stars: repo.stargazers_count || 0,
    /* Confirmed by the student before it reaches a page — a description they
       wrote at 2am is still a claim they have to defend in a room. */
    bullet: parts.length ? `${name} — ${parts.join('. ')}` : name,
  };
}

/**
 * Fetch the public profile and its repositories.
 *
 * Returns `{ ok: false, reason }` rather than throwing: a typo in a username
 * is an ordinary conversational event, and rate limiting is not the student's
 * fault. Nothing here is retried in a loop.
 */
async function importProfile(input, options = {}) {
  const user = usernameFrom(input);
  if (!user) return { ok: false, reason: 'That does not look like a GitHub username or profile URL.' };

  const headers = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'ten-resume-agent',
  };
  /* A token is optional and only ever raises the rate limit — never used to
     reach anything a signed-out visitor could not see. */
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;

  let profile;
  try {
    const res = await httpFetch(`${API}/users/${encodeURIComponent(user)}`, { headers, timeout: 8000 });
    if (res.status === 404) return { ok: false, reason: `GitHub has no public user called "${user}".` };
    if (res.status === 403) return { ok: false, reason: 'GitHub is rate-limiting anonymous requests right now. Paste your projects instead, or try again in a few minutes.' };
    if (!res.ok) return { ok: false, reason: `GitHub replied ${res.status}.` };
    profile = await res.json();
  } catch (e) {
    return { ok: false, reason: 'Could not reach GitHub just now.' };
  }

  let repos = [];
  try {
    const res = await httpFetch(
      `${API}/users/${encodeURIComponent(user)}/repos?per_page=100&sort=pushed`,
      { headers, timeout: 10000 });
    if (res.ok) repos = await res.json();
  } catch (e) { /* the profile alone is still worth something */ }

  const kept = (Array.isArray(repos) ? repos : [])
    .filter(worthListing)
    .slice(0, options.limit || 8)
    .map(asBullet);

  /* Languages across the kept repos, most-used first — evidenced by code the
     person actually pushed, which is a stronger claim than a skills line. */
  const langCount = {};
  kept.forEach((r) => { if (r.language) langCount[r.language] = (langCount[r.language] || 0) + 1; });
  const languages = Object.entries(langCount).sort((a, b) => b[1] - a[1]).map(([l]) => l);

  return {
    ok: true,
    username: user,
    name: profile.name || null,
    bio: profile.bio || null,
    blog: profile.blog || null,
    location: profile.location || null,
    publicRepos: profile.public_repos || 0,
    url: profile.html_url,
    projects: kept,
    languages,
    /* What was left out and why, so the omission is visible rather than
       silent — a fork the student genuinely worked on can be added back. */
    skipped: (Array.isArray(repos) ? repos : []).filter((r) => !worthListing(r)).length,
  };
}

module.exports = { importProfile, usernameFrom, worthListing, asBullet };
