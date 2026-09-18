'use strict';

/**
 * The LinkedIn agent's HTTP surface: /api/v2/linkedin.
 *
 * Staff in the HR, coordinator, mentor and founder dashboards talk to the
 * agent through POST /chat; everything else here is the plumbing around that
 * conversation — the connection status the dashboard card shows, the post
 * history, the poster image, the OAuth handshake that connects the company
 * page, and the direct publish/schedule/delete actions on a stored post.
 *
 * Who may use it is decided once, at the top, for every route: HR,
 * coordinators, mentors, founders and admins. Students, investors and
 * contractors get 403 on all of it, and a request with no session gets 401.
 * The OAuth pair is narrower still (HR and admin only), because connecting the
 * page hands the whole app a token that can post as the company.
 *
 * The thinking lives in services/v2/linkedin/agent.js; the handlers here do
 * not compose, review or decide. They parse the request, hand it to the
 * agent or the client, and shape the answer. That is what keeps the route
 * testable with every sibling module mocked.
 */

const express = require('express');
const crypto = require('crypto');

const { requireRole, attachEcosystemUser } = require('../../middleware/roleGuard');
const { ROLES } = require('../../config/roles');

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
  agent: () => require('../../services/v2/linkedin/agent'),
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

function userOf(req) {
  const u = req.user || {};
  return { role: u.role, id: u._id, name: displayName(req) };
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

/** A post as the dashboard list wants it: no SVG, no PNG, no full text. */
function listRow(p) {
  return mods.agent().postRow(p);
}

function historyEntry(req, action, note) {
  const u = userOf(req);
  return { at: new Date(), by: u.name || String(u.id || '') || u.role, action, note: String(note || '').slice(0, 300) };
}

function pngOf(body) {
  const b64 = body && typeof body.pngBase64 === 'string' ? body.pngBase64.replace(/^data:image\/png;base64,/, '') : '';
  if (!b64) return { buffer: undefined, base64: '' };
  try {
    const buffer = Buffer.from(b64, 'base64');
    return buffer.length ? { buffer, base64: b64 } : { buffer: undefined, base64: '' };
  } catch (e) {
    return { buffer: undefined, base64: '' };
  }
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

/* ── chat ───────────────────────────────────────────────────────────────── */

router.post('/chat', staffOnly, h(async (req, res) => {
  const body = req.body || {};
  const result = await mods.agent().turn({
    message: typeof body.message === 'string' ? body.message : '',
    session: body.session && typeof body.session === 'object' ? body.session : {},
    user: userOf(req),
    pngBase64: typeof body.pngBase64 === 'string' ? body.pngBase64 : undefined,
  });
  res.json(result);
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

/**
 * Publish a stored post. Uses the stored `final` and nothing else: the draft
 * is what the person typed, the final is what the agent cleared, and only
 * the second may leave this server.
 */
router.post('/posts/:id/publish', staffOnly, h(async (req, res) => {
  const LinkedInPost = mods.LinkedInPost();
  if (!validId(req.params.id)) return res.status(404).json({ ok: false, error: 'Post not found' });
  const post = await leanOne(LinkedInPost, req.params.id);
  if (!post) return res.status(404).json({ ok: false, error: 'Post not found' });
  if (post.status === 'published' && !post.dryRun) {
    return res.status(409).json({ ok: false, error: 'This post has already been published.' });
  }
  if (post.status === 'rejected') return res.status(409).json({ ok: false, error: 'This post was discarded; draft it again.' });
  if (!post.final || post.verdict === 'block') {
    return res.status(422).json({ ok: false, error: 'This post has no approved text to publish.' });
  }

  const png = pngOf(req.body);
  const withImage = post.poster ? post.poster.withImage !== false : true;
  const buffer = withImage ? (png.buffer || (post.poster && post.poster.png ? Buffer.from(post.poster.png, 'base64') : undefined)) : undefined;
  const altText = `The Entrepreneurship Network — ${post.kind || 'general'} post`;

  await LinkedInPost.findByIdAndUpdate(post._id, {
    $set: { status: 'publishing' },
    $push: { history: historyEntry(req, 'publishing', buffer ? 'with poster' : 'text only') },
  });

  let result;
  try {
    result = await mods.client().publish({ text: post.final, png: buffer, altText });
  } catch (e) {
    result = { ok: false, dryRun: false, error: e.message };
  }
  const r = result || { ok: false, error: 'no response from the LinkedIn client' };

  if (r.ok || r.dryRun) {
    await LinkedInPost.findByIdAndUpdate(post._id, {
      $set: {
        status: 'published',
        publishedAt: new Date(),
        dryRun: Boolean(r.dryRun),
        linkedin: { postUrn: r.postUrn || '', imageUrn: r.imageUrn || '', url: r.url || '' },
        error: '',
      },
      $push: { history: historyEntry(req, r.dryRun ? 'dry-run' : 'published', r.url || '') },
    });
  } else {
    await LinkedInPost.findByIdAndUpdate(post._id, {
      $set: { status: 'failed', error: String(r.error || '').slice(0, 500) },
      $push: { history: historyEntry(req, 'failed', r.error || '') },
    });
  }

  return res.json({
    ok: Boolean(r.ok || r.dryRun),
    dryRun: Boolean(r.dryRun),
    url: r.url || '',
    postUrn: r.postUrn || '',
    payload: r.payload,
    error: r.error || '',
    notice: r.dryRun ? mods.agent().DRY_RUN_NOTICE : '',
    postId: String(post._id),
  });
}));

router.post('/posts/:id/schedule', staffOnly, h(async (req, res) => {
  const LinkedInPost = mods.LinkedInPost();
  if (!validId(req.params.id)) return res.status(404).json({ ok: false, error: 'Post not found' });
  const post = await leanOne(LinkedInPost, req.params.id);
  if (!post) return res.status(404).json({ ok: false, error: 'Post not found' });
  if (post.status === 'published' && !post.dryRun) {
    return res.status(409).json({ ok: false, error: 'This post has already been published.' });
  }
  if (!post.final || post.verdict === 'block') {
    return res.status(422).json({ ok: false, error: 'This post has no approved text to schedule.' });
  }
  const whenText = req.body && typeof req.body.when === 'string' ? req.body.when.trim() : '';
  if (!whenText) return res.status(400).json({ ok: false, error: 'Say when — for example "tomorrow 10am" (IST).' });
  const when = mods.scheduler().parseWhen(whenText, new Date(), 'Asia/Kolkata');
  if (!when) return res.status(400).json({ ok: false, error: `Could not read "${whenText.slice(0, 60)}" as a future time (IST).` });

  const set = { status: 'scheduled', scheduledFor: when, error: '' };
  const png = pngOf(req.body);
  if (png.base64) set['poster.png'] = png.base64;
  await LinkedInPost.findByIdAndUpdate(post._id, {
    $set: set,
    $push: { history: historyEntry(req, 'scheduled', when.toISOString()) },
  });
  return res.json({ ok: true, scheduledFor: when.toISOString(), scheduledForText: mods.agent().istDateTime(when) });
}));

router.delete('/posts/:id', staffOnly, h(async (req, res) => {
  const LinkedInPost = mods.LinkedInPost();
  if (!validId(req.params.id)) return res.status(404).json({ ok: false, error: 'Post not found' });
  const post = await leanOne(LinkedInPost, req.params.id);
  if (!post) return res.status(404).json({ ok: false, error: 'Post not found' });
  /* A post that is already on LinkedIn cannot be un-posted from here; the
     record stays so the history stays true. */
  if (post.status === 'published' && !post.dryRun) {
    return res.status(409).json({ ok: false, error: 'This post is already published on LinkedIn; delete it there.' });
  }
  await LinkedInPost.findByIdAndUpdate(post._id, {
    $set: { status: 'rejected' },
    $push: { history: historyEntry(req, 'rejected', 'discarded from the dashboard') },
  });
  return res.json({ ok: true });
}));

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
  const u = userOf(req);
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
