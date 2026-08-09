'use strict';

/**
 * Boot-time secret validation.
 *
 * `.env.example` has always promised that "in production the app refuses to
 * boot if any secret marked REQUIRED is missing or too short". This module is
 * that check. Call `assertSecrets()` once, as early as possible in server
 * startup, before any route is registered.
 *
 * Outside production a missing secret is a loud warning rather than a hard
 * stop, so local development still works — but the affected feature stays
 * disabled rather than falling back to a value committed in source.
 */

const IS_PRODUCTION = process.env.NODE_ENV === 'production';

const REQUIRED_SECRETS = [
  {
    name: 'SESSION_SECRET',
    minLength: 32,
    why: 'signs session cookies; a guessable value lets anyone forge a session for any role'
  },
  {
    name: 'ADMIN_API_SECRET',
    minLength: 24,
    why: 'guards the x-admin-secret maintenance endpoints'
  },
  {
    name: 'ADMIN_PASSWORD_HASH',
    minLength: 55, // a bcrypt hash is 60 chars; allow a little slack
    why: 'the admin portal password (bcrypt hash). Without it admin login is disabled',
    validate: (value) => /^\$2[aby]\$/.test(value) || 'must be a bcrypt hash (starts with $2a$ / $2b$ / $2y$)'
  },
  {
    name: 'CORS_ALLOWED_ORIGINS',
    minLength: 1,
    why: 'the browser origin allowlist; without it CORS cannot be locked down'
  },
  {
    name: 'HR_CREDENTIALS',
    minLength: 1,
    why: 'HR login accounts. Without it the app would fall back to accounts whose passwords are public in this repository'
  },
  {
    name: 'COORDINATOR_CREDENTIALS',
    minLength: 1,
    why: 'coordinator login accounts. Same fallback risk as HR_CREDENTIALS'
  }
];

/**
 * @returns {{name: string, reason: string}[]} one entry per failing secret
 */
function collectSecretProblems() {
  const problems = [];

  for (const secret of REQUIRED_SECRETS) {
    const raw = process.env[secret.name];
    const value = typeof raw === 'string' ? raw.trim() : '';

    if (!value) {
      problems.push({ name: secret.name, reason: `is not set — ${secret.why}` });
      continue;
    }
    if (value.length < secret.minLength) {
      problems.push({
        name: secret.name,
        reason: `is too short (${value.length} chars, need at least ${secret.minLength}) — ${secret.why}`
      });
      continue;
    }
    if (typeof secret.validate === 'function') {
      const verdict = secret.validate(value);
      if (verdict !== true) {
        problems.push({ name: secret.name, reason: `${verdict} — ${secret.why}` });
      }
    }
  }

  return problems;
}

/**
 * Validate the environment. Exits the process in production when anything is
 * missing; warns otherwise.
 */
function assertSecrets({ exitOnFailure = IS_PRODUCTION } = {}) {
  const problems = collectSecretProblems();
  if (problems.length === 0) {
    console.log('[secrets] All required secrets are present.');
    return problems;
  }

  const lines = problems.map((p) => `  - ${p.name} ${p.reason}`).join('\n');

  if (exitOnFailure) {
    console.error(
      `\n[secrets] FATAL: refusing to start in production.\n${lines}\n\n` +
      'Set these in the deploy environment (never in a committed file), then restart.\n' +
      'Generate strong values with:  openssl rand -hex 32\n'
    );
    process.exit(1);
  }

  console.warn(
    `\n[secrets] ${problems.length} required secret(s) missing or weak. ` +
    'The affected features are DISABLED. This would be a fatal error in production.\n' +
    `${lines}\n`
  );
  return problems;
}

module.exports = { assertSecrets, collectSecretProblems, REQUIRED_SECRETS, IS_PRODUCTION };
