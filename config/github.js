'use strict';

/**
 * The single definition of TEN's official contribution repository.
 *
 * The Star Performer "Tech Track" asks students to open a pull request against
 * this repo. The URL used to be hardcoded three times inside
 * public/my-documents.html (link href, visible label, input placeholder) with
 * no server-side check at all, so the displayed target and the accepted target
 * could — and did — drift apart.
 *
 * Override with GITHUB_OFFICIAL_REPO ("owner/name") if the repo is ever moved.
 */

const DEFAULT_REPO = 'growth-eng/Ten-Ecosystem1';

const configured = String(process.env.GITHUB_OFFICIAL_REPO || DEFAULT_REPO).trim();
const [OFFICIAL_REPO_OWNER, OFFICIAL_REPO_NAME] = configured.split('/');

const OFFICIAL_REPO_SLUG = `${OFFICIAL_REPO_OWNER}/${OFFICIAL_REPO_NAME}`;
const OFFICIAL_REPO_URL = `https://github.com/${OFFICIAL_REPO_SLUG}/`;

/**
 * Validate a student-submitted pull-request URL.
 *
 * Accepts only `https://github.com/<owner>/<repo>/pull/<number>` for the
 * official repo. Notably rejects:
 *   - other hosts, including look-alikes such as `https://github.com.evil.tld/…`
 *     (a naive `startsWith('https://github.com/')` check accepts those)
 *   - `javascript:` and `data:` URLs, which is what turned this field into a
 *     stored-XSS vector in the HR review queue
 *   - PRs against a different repository
 *
 * @param {unknown} value
 * @returns {{ok: true, url: string, prNumber: number} | {ok: false, message: string}}
 */
function validateOfficialPullRequestUrl(value) {
  if (typeof value !== 'string' || !value.trim()) {
    return { ok: false, message: 'Please paste the URL of your pull request.' };
  }

  const raw = value.trim();
  if (raw.length > 500) {
    return { ok: false, message: 'That URL is too long to be a pull request link.' };
  }

  let parsed;
  try {
    parsed = new URL(raw);
  } catch (_) {
    return { ok: false, message: 'That is not a valid URL.' };
  }

  if (parsed.protocol !== 'https:') {
    return { ok: false, message: 'The pull request URL must start with https://' };
  }
  // Exact host match — no suffix tricks.
  if (parsed.hostname.toLowerCase() !== 'github.com') {
    return { ok: false, message: 'The pull request must be hosted on github.com.' };
  }

  // /<owner>/<repo>/pull/<number>
  const segments = parsed.pathname.split('/').filter(Boolean);
  if (segments.length < 4 || segments[2].toLowerCase() !== 'pull') {
    return { ok: false, message: `Link directly to your pull request, e.g. ${OFFICIAL_REPO_URL}pull/1` };
  }

  const [owner, repo, , number] = segments;
  const repoName = repo.replace(/\.git$/i, '');
  if (owner.toLowerCase() !== OFFICIAL_REPO_OWNER.toLowerCase() ||
      repoName.toLowerCase() !== OFFICIAL_REPO_NAME.toLowerCase()) {
    return { ok: false, message: `The pull request must be against ${OFFICIAL_REPO_SLUG}.` };
  }

  // Require the segment to be digits and nothing else. Number.parseInt() alone
  // is too permissive here: it stops at the first non-digit, so
  // `1"><script>alert(1)</script>` would parse as 1 and the URL would be
  // accepted. Normalisation below would strip the payload, but a caller that
  // used the raw input instead of `result.url` would then be exposed — so this
  // rejects rather than silently repairs.
  if (!/^\d+$/.test(number)) {
    return { ok: false, message: 'That pull request number does not look right.' };
  }
  const prNumber = Number.parseInt(number, 10);
  if (!Number.isSafeInteger(prNumber) || prNumber <= 0) {
    return { ok: false, message: 'That pull request number does not look right.' };
  }

  // Return a normalised URL so what is stored and rendered is one canonical
  // shape, not whatever the student pasted.
  return {
    ok: true,
    url: `https://github.com/${OFFICIAL_REPO_SLUG}/pull/${prNumber}`,
    prNumber
  };
}

module.exports = {
  OFFICIAL_REPO_OWNER,
  OFFICIAL_REPO_NAME,
  OFFICIAL_REPO_SLUG,
  OFFICIAL_REPO_URL,
  validateOfficialPullRequestUrl
};
