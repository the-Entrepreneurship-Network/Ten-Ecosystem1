'use strict';

/**
 * @fileoverview Centralised secret loading with fail-closed semantics.
 *
 * SECURITY: This module deliberately refuses to supply default values for
 * security-critical secrets. Hardcoded fallbacks (the previous behaviour)
 * mean any deployment that forgets an env var silently ships with a
 * publicly-known credential. In production we crash at boot instead.
 *
 * In non-production we generate a random ephemeral value so local dev still
 * works, but the value changes every restart and is never a known constant.
 */

const crypto = require('crypto');

const IS_PRODUCTION = process.env.NODE_ENV === 'production';

const missing = [];

/**
 * Read a required secret.
 * @param {string} name Environment variable name.
 * @param {{ minLength?: number }} [opts]
 * @returns {string}
 */
function required(name, opts) {
  const minLength = (opts && opts.minLength) || 0;
  const raw = process.env[name];
  const value = typeof raw === 'string' ? raw.trim() : '';

  if (!value || value.length < minLength) {
    if (IS_PRODUCTION) {
      missing.push(value ? name + ' (too short: needs >= ' + minLength + ' chars)' : name);
      return '';
    }
    const ephemeral = crypto.randomBytes(32).toString('hex');
    console.warn(
      '[secrets] ' + name + ' is not set. Generated an ephemeral dev value. ' +
      'It changes on every restart and MUST be set in production.'
    );
    return ephemeral;
  }
  return value;
}

/**
 * Read an optional secret. Returns '' when unset.
 * @param {string} name
 * @returns {string}
 */
function optional(name) {
  const raw = process.env[name];
  return typeof raw === 'string' ? raw.trim() : '';
}

const secrets = {
  SESSION_SECRET:   required('SESSION_SECRET',   { minLength: 32 }),
  ADMIN_API_SECRET: required('ADMIN_API_SECRET', { minLength: 24 }),

  // bcrypt hash of the admin portal password. Generate with:
  //   node -e "console.log(require('bcryptjs').hashSync(process.argv[1],12))" 'your-password'
  ADMIN_PASSWORD_HASH: optional('ADMIN_PASSWORD_HASH'),
  ADMIN_USERNAME:      optional('ADMIN_USERNAME') || 'tenadmin',

  PAYMENTSETU_API_KEY:    optional('PAYMENTSETU_API_KEY'),
  PAYMENT_WEBHOOK_SECRET: optional('PAYMENT_WEBHOOK_SECRET'),

  CORS_ALLOWED_ORIGINS: optional('CORS_ALLOWED_ORIGINS'),

  ENABLE_CODE_RUNNER: optional('ENABLE_CODE_RUNNER') === 'true',
};

if (IS_PRODUCTION && missing.length) {
  console.error(
    '\n[secrets] FATAL: refusing to start in production with missing/weak secrets:\n' +
    missing.map(function (m) { return '  - ' + m; }).join('\n') +
    "\n\nSet these in your hosting platform's environment configuration.\n"
  );
  process.exit(1);
}

if (IS_PRODUCTION && !secrets.ADMIN_PASSWORD_HASH) {
  console.error(
    '\n[secrets] FATAL: ADMIN_PASSWORD_HASH is not set. The admin portal cannot ' +
    'be secured without it. Generate one with:\n' +
    '  node -e "console.log(require(\'bcryptjs\').hashSync(process.argv[1],12))" \'your-password\'\n'
  );
  process.exit(1);
}

module.exports = secrets;