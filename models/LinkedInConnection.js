'use strict';

const mongoose = require('mongoose');

/*
 * The company page's LinkedIn connection — one document, keyed 'default'.
 *
 * There is exactly one page (The Entrepreneurship Network) and exactly one
 * token for it, so this is a singleton rather than a per-user table: whoever
 * completes the OAuth flow connects the page for everyone, and reconnecting
 * overwrites the same row instead of leaving a trail of stale tokens.
 *
 * `accessToken` and `refreshToken` are `select: false`. Every ordinary read
 * (the /status card, the history list, a debugging `findOne` in a console)
 * therefore gets a document WITHOUT the secret, and only the client that is
 * about to call LinkedIn asks for it explicitly with
 * `.select('+accessToken +refreshToken')`. That is the difference between a
 * token that leaks into a JSON response by accident and one that cannot.
 *
 * LinkedIn access tokens live ~60 days and refresh tokens are only issued to
 * some partner programmes, so `expiresAt` is stored and surfaced as a warning
 * a week out — the alternative is discovering the token died when a
 * scheduled post fails at 9am.
 */
const linkedInConnectionSchema = new mongoose.Schema({
  key: { type: String, default: 'default', unique: true },

  accessToken: { type: String, select: false, default: '' },
  refreshToken: { type: String, select: false, default: '' },
  expiresAt: { type: Date },
  scopes: { type: [String], default: [] },

  orgUrn: { type: String, default: '' },
  orgName: { type: String, default: '' },
  orgVanity: { type: String, default: '' },

  connectedBy: {
    role: { type: String, default: '' },
    id: { type: String, default: '' },
    name: { type: String, default: '' },
  },
  connectedAt: { type: Date },
}, { timestamps: true });

module.exports = mongoose.model('LinkedInConnection', linkedInConnectionSchema);
