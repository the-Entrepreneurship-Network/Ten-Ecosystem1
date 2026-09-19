'use strict';

/**
 * The LinkedIn section's HTTP surface: /api/v2/linkedin.
 *
 * One endpoint. It answers with the fourteen internship openings — the poster
 * or posters for each, and the post text that goes with them — and that is the
 * entire API.
 *
 * It used to be a great deal more: OAuth start and callback, connect and
 * disconnect, a post history, publishing status, LinkedIn's own share
 * statistics. All of it existed to let this server post to the company page by
 * itself, and none of it exists now. A bot posting to a company page is what
 * gets the page restricted, and the page is where the applications come from,
 * so the whole posting path was removed rather than guarded. There is no token
 * here, nothing to connect, and no credential this route could leak.
 *
 * What replaced it is a person. They open the section, copy the words,
 * download the poster and post it from their own account — which reaches
 * further than a company page does, and cannot get the company page banned.
 */

const express = require('express');

const { requireRole, attachEcosystemUser } = require('../../middleware/roleGuard');
const { ALL_ROLES } = require('../../config/roles');

const router = express.Router();

/*
 * Identity from the session, and the session alone. The app mounts
 * attachEcosystemUser globally, but this router must not depend on mount
 * order to be safe: run it again here (it is idempotent — it only reads the
 * session), so a request that somehow arrives without req.user is still
 * refused by requireRole rather than mistaken for anyone.
 */
router.use(attachEcosystemUser);

/*
 * One gate, and it is the widest one: every role this app has.
 *
 * The section is a noticeboard. Everything on it is copy the company wants
 * spread as far as it will go, and the people best placed to spread it are the
 * students — an intern posting "this is where I am interning" outperforms the
 * company page saying the same thing, and fourteen of them outperform it
 * badly. Locking the openings behind a staff gate would be locking the door on
 * the distribution.
 *
 * Deriving the list from ALL_ROLES rather than naming roles means a role added
 * to config/roles.js later is admitted without anybody remembering to come
 * back here.
 */
const signedIn = requireRole(...ALL_ROLES);

/* Required on first use rather than at load, so a mistake in the openings
   module cannot stop this router mounting — the same reason the old version of
   this file did it, and the reason server.js wraps the mount in its own try. */
const openings = () => require('../../services/v2/linkedin/openings');

/** Wrap an async handler so a rejected promise is a 500, never a hang. */
function h(fn) {
  return function handler(req, res) {
    Promise.resolve()
      .then(() => fn(req, res))
      .catch((err) => {
        console.error(`[linkedin] ${req.method} ${req.path}:`, err && err.stack ? err.stack : err);
        if (!res.headersSent) res.status(500).json({ ok: false, error: 'Something went wrong' });
      });
  };
}

/**
 * The fourteen openings: poster URLs, alt text, and the post for each.
 *
 * The text is built here rather than in the browser so that the copy has one
 * source of truth. Two people posting slightly different versions of the same
 * opening is how a stipend figure or an apply link drifts, and the fix for
 * that is that the template only exists on the server.
 *
 * `posters` lists only the plates that are actually on disk. The second poster
 * set — the TEN-building variant — is not committed yet, so most domains
 * return one entry today and will return two the day the files land, with no
 * change here. A domain with no plate at all still returns its text; the words
 * are the part that cannot be missing.
 */
router.get('/openings', signedIn, h(async (req, res) => {
  res.json({ ok: true, openings: openings().list() });
}));

module.exports = router;
