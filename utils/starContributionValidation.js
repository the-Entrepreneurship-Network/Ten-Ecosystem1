'use strict';

const OFFICIAL_STAR_PERFORMER_REPO_URL = 'https://github.com/growth-eng/Ten-Ecosystem1/';
const OFFICIAL_STAR_PERFORMER_REPO_PR_PREFIX = `${OFFICIAL_STAR_PERFORMER_REPO_URL}pull/`;
const GITHUB_API_BASE = 'https://api.github.com';

function normalizeGithubHostname(hostname) {
  return String(hostname || '').trim().toLowerCase().replace(/^www\./, '');
}

function isHttpUrl(value) {
  try {
    const url = new URL(String(value || '').trim());
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch (_) {
    return false;
  }
}

function isOfficialStarPerformerPullRequestUrl(value) {
  try {
    const url = new URL(String(value || '').trim());
    const pathSegments = url.pathname.split('/').filter(Boolean);

    return (
      normalizeGithubHostname(url.hostname) === 'github.com' &&
      pathSegments.length >= 4 &&
      pathSegments[0] === 'growth-eng' &&
      pathSegments[1] === 'Ten-Ecosystem1' &&
      pathSegments[2] === 'pull' &&
      /^\d+$/.test(pathSegments[3])
    );
  } catch (_) {
    return false;
  }
}

async function githubApiRequest(url) {
  const headers = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'TEN-Portal-Star-Performer-Validator'
  };

  if (process.env.GITHUB_API_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GITHUB_API_TOKEN}`;
  }

  const response = await fetch(url, { headers });
  return response;
}

async function verifyGithubUsernameExists(username) {
  try {
    const response = await githubApiRequest(`${GITHUB_API_BASE}/users/${encodeURIComponent(username)}`);
    return response.ok;
  } catch (_) {
    return false;
  }
}

async function verifyGithubPullRequestExists(prUrl) {
  try {
    const url = new URL(String(prUrl || '').trim());
    const pathSegments = url.pathname.split('/').filter(Boolean);
    const prNumber = pathSegments[3];

    if (!prNumber || !/^\d+$/.test(prNumber)) {
      return false;
    }

    const response = await githubApiRequest(`${GITHUB_API_BASE}/repos/growth-eng/Ten-Ecosystem1/pulls/${prNumber}`);
    return response.ok;
  } catch (_) {
    return false;
  }
}

async function validateStarContribution(contribution) {
  let parsed = contribution;

  if (typeof contribution === 'string') {
    try {
      parsed = JSON.parse(contribution);
    } catch (_) {
      return { valid: false, error: 'Contribution payload must be valid JSON.' };
    }
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { valid: false, error: 'Contribution payload must be a valid object.' };
  }

  if (parsed.track === 'tech') {
    const githubUsername = String(parsed.githubUsername || '').trim();
    const githubPR = String(parsed.githubPR || '').trim();

    if (!githubUsername) {
      return { valid: false, error: 'GitHub username is required for Tech Track submissions.' };
    }

    if (!isOfficialStarPerformerPullRequestUrl(githubPR)) {
      return {
        valid: false,
        error: `Tech Track PR URL must point to ${OFFICIAL_STAR_PERFORMER_REPO_URL}`
      };
    }

    const usernameExists = await verifyGithubUsernameExists(githubUsername);
    if (!usernameExists) {
      return {
        valid: false,
        error: 'GitHub username could not be verified. Please use a real GitHub username.'
      };
    }

    const prExists = await verifyGithubPullRequestExists(githubPR);
    if (!prExists) {
      return {
        valid: false,
        error: 'GitHub PR link could not be verified. Please submit a real pull request link that exists on the official repository.'
      };
    }
  } else if (parsed.track === 'business') {
    if (!isHttpUrl(parsed.businessLink)) {
      return { valid: false, error: 'Business Track document link must be a valid URL.' };
    }
  } else {
    return { valid: false, error: 'Contribution track must be either tech or business.' };
  }

  return { valid: true, contribution: parsed };
}

module.exports = {
  OFFICIAL_STAR_PERFORMER_REPO_URL,
  OFFICIAL_STAR_PERFORMER_REPO_PR_PREFIX,
  isOfficialStarPerformerPullRequestUrl,
  validateStarContribution
};
