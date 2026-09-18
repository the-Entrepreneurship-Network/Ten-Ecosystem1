'use strict';

/**
 * The LinkedIn agent's HTTP surface: /api/v2/linkedin.
 *
 * Every route here reads. None of them writes a post, and that is the whole
 * shape of this file: the posts are written by the weekend autopilot and sent
 * by the scheduler, both of them crons, with nobody logged in. What is left
 * for a dashboard to do is look.
 *
 * `GET /feed` is the one every portal calls and every signed-in role may read
 * — students, investors and contractors included. It answers with the posts
 * the company page has published and nothing else. The operational views
 * (history with failure states, connection status, LinkedIn's statistics) stay
 * staff-only, and the OAuth pair is narrower still, HR and admin, because
 * connecting the page hands the whole app a token that can post as the
 * company. A request with no session gets 401 everywhere.
 *
 * The thinking lives in services/v2/linkedin/; the handlers here do not
 * compose, review or decide. They parse the request, hand it to the autopilot
 * or the client, and shape the answer. That is what keeps the route testable
 * with every sibling module mocked.
 */

const express = require('express');
const crypto = require('crypto');

const { requireRole, attachEcosystemUser } = require('../../middleware/roleGuard');
const { ROLES, ALL_ROLES } = require('../../config/roles');

const router = express.Router();

/*
 * The publish body carries the poster as base64 PNG (a 1200x1200 poster is
 * a few hundred KB), well past express.json's default 100kb. The parser is
 * mounted here so this section sets its own limit without changing what any
 * other route accepts. Note for whoever mounts this router: the app's global
 * express.json() runs first, and a body it has already rejected as too large
 * never reaches this one — the global parser needs a matching limit, or this
 * router must be mounted ahead of it.
 */
router.use(express.json({ limit: '6mb' }));

/*
 * Identity from the session, and the session alone. The app mounts
 * attachEcosystemUser globally, but this router must not depend on mount
 * order to be safe: run it again here (it is idempotent — it only reads the
 * session), so a request that somehow arrives without req.user is still
 * refused by requireRole rather than mistaken for anyone.
 */
router.use(attachEcosystemUser);

/*
 * Three gates, widest first.
 *
 * `signedIn` is every role this app has, which is what the feed uses: the
 * LinkedIn section shows the company's own published posts and carries no
 * controls, so a student seeing it is a student reading something already
 * public. Built from ALL_ROLES rather than a hand-written list, so a role
 * added to config/roles.js later is admitted without anybody remembering to
 * come back here — the alternative failure is a new role locked out of a
 * section every other role can see, and nobody noticing for a release.
 *
 * `staffOnly` keeps the operational views: the post history with its failure
 * states, the connection status, LinkedIn's own statistics.
 *
 * `connectOnly` is narrower still, because connecting the page hands this
 * server a token that can post as the company.
 */
const signedIn = requireRole(...ALL_ROLES);
const staffOnly = requireRole(ROLES.HR, ROLES.COORDINATOR, ROLES.MENTOR, ROLES.FOUNDER, ROLES.ADMIN);
const connectOnly = requireRole(ROLES.HR, ROLES.ADMIN);

const PORTAL_AFTER_OAUTH = '/hr-portal#linkedin-agent';
const ORG_VANITY = 'the-entrepreneurship-network';

/* ── lazy modules ───────────────────────────────────────────────────────── */

/*
 * Required on first use rather than at load. The models and the client are
 * written by other people against the same spec; requiring them at the top
 * would make this router fail to mount (and, in server.js, unmount nothing
 * else — but still) while any one of them is missing, and would force the
 * tests to mock every module before the router is even loaded.
 */
const mods = {
  autopilot: () => require('../../services/v2/linkedin/autopilot'),
  client: () => require('../../services/v2/linkedin/linkedinClient'),
  scheduler: () => require('../../services/v2/linkedin/scheduler'),
  posters: () => require('../../services/v2/linkedin/posterStudio'),
  llm: () => require('../../services/v2/linkedin/llm'),
  LinkedInPost: () => require('../../models/LinkedInPost'),
  LinkedInConnection: () => require('../../models/LinkedInConnection'),
};

/* ── helpers ────────────────────────────────────────────────────────────── */

/** Wrap an async handler so a rejected promise is a 500, never a hang. */
function h(fn) {
  return function handler(req, res) {
    Promise.resolve()
      .then(() => fn(req, res))
      .catch((err) => {
        console.error(`[linkedin-agent] ${req.method} ${req.path}:`, err && err.stack ? err.stack : err);
        if (!res.headersSent) res.status(500).json({ ok: false, error: 'Something went wrong' });
      });
  };
}

/**
 * The display name for the person on this request, from whichever session
 * shape their portal wrote. Used for the author line on posts and the history
 * trail — the id alone ("py_admin") is not something a colleague reading the
 * log recognises.
 */
function displayName(req) {
  const s = req.session || {};
  if (s.hr) return String(s.hr.name || s.hr.username || s.hr.email || '');
  if (s.coordinator) return String(s.coordinator.name || s.coordinator.username || '');
  if (s.adminUser) return String(s.adminUser.name || s.adminUser.username || '');
  return String(s.ecosystemUserName || '');
}

const OBJECT_ID = /^[a-f0-9]{24}$/i;

function validId(id) {
  return typeof id === 'string' && OBJECT_ID.test(id);
}

/**
 * config() minus anything secret. The client never returns the token, but
 * this is the one place the shape is fixed for the dashboard, so the fields
 * are named explicitly rather than spread — a future field on the client's
 * side cannot leak through by accident.
 */
function publicConfig(cfg) {
  const c = cfg || {};
  return {
    configured: Boolean(c.configured),
    orgUrn: c.orgUrn || '',
    orgName: c.orgName || '',
    apiVersion: c.apiVersion || '',
    source: c.source || 'none',
    expiresAt: c.expiresAt ? new Date(c.expiresAt).toISOString() : '',
    expiresInDays: typeof c.expiresInDays === 'number' ? c.expiresInDays : daysUntil(c.expiresAt),
  };
}

function daysUntil(date) {
  if (!date) return null;
  const t = new Date(date).getTime();
  if (Number.isNaN(t)) return null;
  return Math.floor((t - Date.now()) / (24 * 60 * 60 * 1000));
}

function schedulerEnabled() {
  return process.env.NODE_ENV !== 'test' && !process.env.LINKEDIN_SCHEDULER_DISABLED;
}

async function leanOne(Model, id) {
  let q = Model.findById(id);
  if (q && typeof q.lean === 'function') q = q.lean();
  return (await q) || null;
}

async function leanMany(Model, filter, opts) {
  const o = opts || {};
  let q = Model.find(filter);
  if (q && typeof q.sort === 'function' && o.sort) q = q.sort(o.sort);
  if (q && typeof q.limit === 'function' && o.limit) q = q.limit(o.limit);
  if (q && typeof q.select === 'function' && o.select) q = q.select(o.select);
  if (q && typeof q.lean === 'function') q = q.lean();
  const rows = await q;
  return Array.isArray(rows) ? rows : [];
}

/**
 * A post as the dashboard list wants it: no SVG, no PNG, no full text.
 *
 * Shaped here rather than borrowed from the agent module, so that the fields
 * the dashboard receives are visible in the file that serves them — and so
 * that a field added to the model later does not appear in the response
 * without anybody deciding it should.
 */
function listRow(p) {
  const post = p || {};
  const first = String(post.final || post.draft || '').split('\n').find((l) => l.trim()) || '';
  return {
    id: String(post._id || ''),
    kind: post.kind || 'general',
    domain: post.domain || '',
    source: post.source || 'agent',
    status: post.status || 'draft',
    verdict: post.verdict || 'ok',
    dryRun: Boolean(post.dryRun),
    excerpt: first.trim().slice(0, 160),
    createdAt: post.createdAt,
    scheduledFor: post.scheduledFor,
    publishedAt: post.publishedAt,
    url: (post.linkedin && post.linkedin.url) || '',
    error: post.error || '',
  };
}

/* ── status ─────────────────────────────────────────────────────────────── */

router.get('/status', staffOnly, h(async (req, res) => {
  let cfg = {};
  try { cfg = mods.client().config() || {}; } catch (e) { cfg = {}; }
  let llm = null;
  try { llm = mods.llm().provider() || null; } catch (e) { llm = null; }
  const linkedin = publicConfig(cfg);
  let warning = '';
  if (linkedin.configured && typeof linkedin.expiresInDays === 'number') {
    if (linkedin.expiresInDays < 0) warning = 'The LinkedIn token has expired — reconnect the page to post again.';
    else if (linkedin.expiresInDays < 7) warning = `The LinkedIn token expires in ${linkedin.expiresInDays} day${linkedin.expiresInDays === 1 ? '' : 's'} — reconnect soon.`;
  }
  res.json({
    ok: true,
    role: req.user.role,
    name: displayName(req),
    canConnect: req.user.role === ROLES.HR || req.user.role === ROLES.ADMIN,
    linkedin,
    llm,
    scheduler: { enabled: schedulerEnabled() },
    warning,
  });
}));

/* ── the feed ───────────────────────────────────────────────────────────── */

/**
 * The posts the agent has put on the company page — the one thing the
 * dashboards show, and the one route anybody signed in may read.
 *
 * `signedIn` rather than `staffOnly`, and that is the deliberate part. The
 * LinkedIn section is a window onto what the company published; it has no
 * controls, so there is nothing in it a student could operate. Hiding the
 * company's own public posts from the interns they are advertising for would
 * be protecting nothing. Anonymous requests are still refused: this is a
 * portal section, not a public API.
 *
 * What the payload deliberately leaves out is everything operational —
 * failure counts, error strings, the queue, the rotation, the token's
 * expiry. Those are real and they are in the database; they are just not this
 * endpoint's business. The two connection fields are added only for the roles
 * that can act on them.
 */
router.get('/feed', signedIn, h(async (req, res) => {
  const autopilot = mods.autopilot();
  const out = await autopilot.feed({}, req.query.limit);
  const body = { ok: true, count: out.count, posts: out.posts };

  if (req.user.role === ROLES.HR || req.user.role === ROLES.ADMIN) {
    let cfg = {};
    try { cfg = mods.client().config() || {}; } catch (e) { cfg = {}; }
    body.canConnect = true;
    body.connected = Boolean(cfg.configured);
  }
  res.json(body);
}));

/**
 * The poster for one post, for the posts whose image is not one of the
 * fourteen committed plates — an older hand-written post, or a domain the
 * rotation does not know.
 *
 * Served from the stored bytes rather than redirected, because the bytes are
 * what went to LinkedIn. `withImage === false` means the post went out as
 * text and there is nothing to send.
 */
router.get('/feed/:id/image', signedIn, h(async (req, res) => {
  if (!validId(req.params.id)) return res.status(404).type('text/plain').send('Not found');
  const post = await leanOne(mods.LinkedInPost(), req.params.id);
  /* Only published posts. A queued one has not been said yet, and the feed
     must not become a way to read tomorrow's post today. */
  if (!post || post.status !== 'published') return res.status(404).type('text/plain').send('Not found');
  const poster = post.poster || {};
  if (poster.withImage === false || !poster.png) return res.status(404).type('text/plain').send('No image on this post');

  let buf;
  try {
    buf = Buffer.from(poster.png, 'base64');
  } catch (e) {
    buf = null;
  }
  if (!buf || !buf.length) return res.status(404).type('text/plain').send('No image on this post');

  /* The stored bytes are whatever was uploaded — a JPEG from the poster kit,
     or a PNG rasterised in a browser by the old chat agent. Sniff rather than
     assume: a PNG served as image/jpeg renders in every browser that guesses,
     and in none that does not. */
  const isPng = buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
  res.set('Content-Type', isPng ? 'image/png' : 'image/jpeg');
  res.set('Cache-Control', 'private, max-age=86400');
  return res.send(buf);
}));

/* ── posts ──────────────────────────────────────────────────────────────── */

router.get('/posts', staffOnly, h(async (req, res) => {
  const limit = Math.max(1, Math.min(100, parseInt(req.query.limit, 10) || 20));
  const rows = await leanMany(mods.LinkedInPost(), {}, { sort: { createdAt: -1 }, limit, select: '-poster.svg -poster.png' });
  res.json({ ok: true, posts: rows.map(listRow) });
}));

router.get('/posts/:id', staffOnly, h(async (req, res) => {
  if (!validId(req.params.id)) return res.status(404).json({ ok: false, error: 'Post not found' });
  const post = await leanOne(mods.LinkedInPost(), req.params.id);
  if (!post) return res.status(404).json({ ok: false, error: 'Post not found' });
  /* The PNG is a scheduler-only payload; the SVG is what the page renders. */
  if (post.poster) delete post.poster.png;
  return res.json({ ok: true, post });
}));

router.get('/posts/:id/poster.svg', staffOnly, h(async (req, res) => {
  if (!validId(req.params.id)) return res.status(404).type('text/plain').send('Post not found');
  const post = await leanOne(mods.LinkedInPost(), req.params.id);
  if (!post) return res.status(404).type('text/plain').send('Post not found');
  let svg = post.poster && post.poster.svg;
  if (!svg) {
    /* Older or scheduled posts may carry fields without a rendered SVG;
       rebuild from the fields rather than answer with nothing. */
    const built = mods.posters().build({
      template: (post.poster && post.poster.template) || post.kind || 'general',
      fields: (post.poster && post.poster.fields) || {},
      size: 'square',
    });
    svg = built && built.svg;
  }
  if (!svg) return res.status(404).type('text/plain').send('No poster for this post');
  res.set('Content-Type', 'image/svg+xml; charset=utf-8');
  res.set('Cache-Control', 'private, max-age=300');
  return res.send(svg);
}));

/*
 * There is no publish, schedule or delete route.
 *
 * There used to be all three, plus a chat endpoint, because a staff member
 * wrote the post and pressed the button. Now the weekend job writes it and
 * the scheduler sends it, so the only thing a dashboard does with a post is
 * look at it. Leaving a publish route mounted "just in case" would mean a
 * second way for text to reach the company page — one with no rotation, no
 * slot key and no guarantee of which domain it named — which is precisely
 * the arrangement this change exists to remove.
 */

/* ── OAuth ──────────────────────────────────────────────────────────────── */

/*
 * Connecting the page. LinkedIn's authorization-code flow: send the person to
 * LinkedIn with a random state kept in their session, get the code back on
 * the callback, swap it for a token, work out which organisation the token
 * administers, and store the lot in the singleton LinkedInConnection. The
 * token never appears in a response or a log; the callback answers with a
 * redirect to the portal and nothing else.
 */
router.get('/oauth/start', connectOnly, h(async (req, res) => {
  const clientId = process.env.LINKEDIN_CLIENT_ID || '';
  const redirectUri = process.env.LINKEDIN_REDIRECT_URI || '';
  if (!clientId || !redirectUri) {
    return res.status(400).json({
      ok: false,
      error: 'LinkedIn sign-in is not configured on this server. Set LINKEDIN_CLIENT_ID, LINKEDIN_CLIENT_SECRET and LINKEDIN_REDIRECT_URI, or paste a LINKEDIN_ACCESS_TOKEN.',
    });
  }
  const client = mods.client();
  const state = crypto.randomBytes(16).toString('hex');
  if (req.session) req.session.linkedinOAuthState = state;
  const url = client.oauthUrl({ clientId, redirectUri, state, scopes: client.DEFAULT_SCOPES });
  return res.redirect(302, url);
}));

router.get('/oauth/callback', connectOnly, h(async (req, res) => {
  const code = typeof req.query.code === 'string' ? req.query.code : '';
  const state = typeof req.query.state === 'string' ? req.query.state : '';
  const expected = req.session && req.session.linkedinOAuthState;
  if (req.session) delete req.session.linkedinOAuthState;

  if (req.query.error) {
    return res.status(400).json({ ok: false, error: `LinkedIn declined the connection: ${String(req.query.error_description || req.query.error).slice(0, 200)}` });
  }
  if (!code || !state || !expected || state !== expected) {
    /* A mismatched state is either a stale tab or a forged link; neither gets
       a token stored against the company page. */
    return res.status(400).json({ ok: false, error: 'This sign-in link is stale or was not started from here. Click Connect LinkedIn again.' });
  }
  const clientId = process.env.LINKEDIN_CLIENT_ID || '';
  const clientSecret = process.env.LINKEDIN_CLIENT_SECRET || '';
  const redirectUri = process.env.LINKEDIN_REDIRECT_URI || '';
  if (!clientId || !clientSecret || !redirectUri) {
    return res.status(400).json({ ok: false, error: 'LinkedIn sign-in is not fully configured on this server (LINKEDIN_CLIENT_SECRET is missing).' });
  }

  const client = mods.client();
  const tok = await client.exchangeCode({ code, clientId, clientSecret, redirectUri });
  if (!tok || !tok.accessToken) {
    return res.status(502).json({ ok: false, error: 'LinkedIn did not return a token. Try connecting again.' });
  }

  const org = await pickOrganization(client, tok.accessToken);
  const expiresAt = new Date(Date.now() + (Number(tok.expiresIn) > 0 ? Number(tok.expiresIn) : 60 * 24 * 3600) * 1000);
  const u = { role: req.user && req.user.role, id: req.user && req.user._id, name: displayName(req) };
  await mods.LinkedInConnection().findOneAndUpdate(
    { key: 'default' },
    {
      $set: {
        key: 'default',
        accessToken: tok.accessToken,
        refreshToken: tok.refreshToken || '',
        expiresAt,
        scopes: typeof tok.scope === 'string' ? tok.scope.split(/[\s,]+/).filter(Boolean) : (Array.isArray(tok.scope) ? tok.scope : client.DEFAULT_SCOPES),
        orgUrn: org.orgUrn || '',
        orgName: org.name || '',
        orgVanity: org.vanity || '',
        connectedBy: { role: u.role, id: String(u.id || ''), name: u.name },
        connectedAt: new Date(),
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
  return res.redirect(302, PORTAL_AFTER_OAUTH);
}));

/**
 * Which organisation the new token should post as. LINKEDIN_ORG_ID wins when
 * set; otherwise the page whose vanity name is ours; otherwise the first page
 * the token administers. The vanity lookup can fail on a token without the
 * admin scope, so each step is best-effort and the next one is tried.
 */
async function pickOrganization(client, token) {
  const envOrg = process.env.LINKEDIN_ORG_ID || '';
  if (envOrg) {
    const orgUrn = /^urn:li:organization:/.test(envOrg) ? envOrg : `urn:li:organization:${envOrg}`;
    return { orgUrn, name: '', vanity: ORG_VANITY };
  }
  try {
    const found = await client.resolveOrganization({ token, vanityName: ORG_VANITY });
    if (found && found.orgUrn) return { orgUrn: found.orgUrn, name: found.name || '', vanity: ORG_VANITY };
  } catch (e) {
    console.error('[linkedin-agent] vanity lookup failed:', e.message);
  }
  try {
    if (typeof client.listAdministeredOrganizations === 'function') {
      const orgs = await client.listAdministeredOrganizations({ token });
      const first = Array.isArray(orgs) ? orgs.find((o) => o && o.orgUrn) : null;
      if (first) return { orgUrn: first.orgUrn, name: '', vanity: '' };
    }
  } catch (e) {
    console.error('[linkedin-agent] organisation listing failed:', e.message);
  }
  return { orgUrn: '', name: '', vanity: '' };
}

/* ── stats ──────────────────────────────────────────────────────────────── */

router.get('/stats', staffOnly, h(async (req, res) => {
  const client = mods.client();
  let cfg = {};
  try { cfg = client.config() || {}; } catch (e) { cfg = {}; }
  if (!cfg.configured) {
    return res.json({ ok: false, reason: 'LinkedIn is not connected on this server.' });
  }
  const stats = await client.shareStatistics({ orgUrn: cfg.orgUrn });
  if (!stats) return res.json({ ok: false, reason: 'LinkedIn did not return statistics.' });
  return res.json({ ok: true, stats });
}));

module.exports = router;
