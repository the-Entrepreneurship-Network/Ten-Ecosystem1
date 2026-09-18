'use strict';

/**
 * Everything this app knows about talking to LinkedIn's REST API.
 *
 * The one rule that shapes the whole file: **publish() never throws and never
 * needs a token to be useful.** This deployment normally has no LinkedIn token
 * at all — nobody has completed the OAuth handshake yet, and the test suite
 * runs with an empty environment on purpose — so the ordinary state of the
 * world is "unconfigured". If an unconfigured publish threw, or returned a
 * bare `{ ok: false }`, the agent above would have to special-case it and the
 * dashboard would show a dead end. Instead an unconfigured publish returns the
 * complete payload that *would* have been sent, marked `dryRun`, so staff can
 * read the exact JSON, the poster still renders, the post is still recorded,
 * and connecting the page later changes nothing except that the payload
 * actually leaves the building.
 *
 * The second rule: **the token never leaves this module.** config() is called
 * by the route and rendered into the dashboard, so it reports whether a token
 * exists, where it came from and when it dies — and nothing else. There is no
 * code path here that logs a token, returns one, or puts one in an error
 * message; the 401 handler deliberately says "token rejected" rather than
 * echoing what was sent.
 *
 * The request shapes below were checked against LinkedIn's official
 * documentation and are not guesses. The ones that are easy to get wrong, and
 * that silently half-work when you do:
 *
 *   - The created post's URN comes back in the **`x-restli-id` response
 *     header**, not in the body. The body of a 201 from /rest/posts is empty.
 *     Code that parsed the body got `undefined`, stored an empty URN, and the
 *     history view then had no link to the live post even though the post was
 *     up.
 *   - Images are a three-step dance: initializeUpload to get a signed URL and
 *     the image URN, a raw PUT of the bytes to that URL, then polling the
 *     image until its status is AVAILABLE. Attaching the URN to a post before
 *     LinkedIn has finished processing it produces a post with a broken image
 *     and no error anywhere.
 *   - `commentary` is "little text format": every one of `| { } @ [ ] ( ) < >
 *     # \ * _ ~` must be backslash-escaped even when it is not being used as
 *     markup. An unescaped "(" in "Python (Django)" makes LinkedIn reject the
 *     whole post with a parse error that names no offset.
 *   - The `Linkedin-Version` header is mandatory on every /rest call. Without
 *     it every request 400s, which reads like an auth problem and is not.
 */

const { httpFetch } = require('../httpFetch');

const API_BASE = 'https://api.linkedin.com/rest';
const OAUTH_AUTHORIZE = 'https://www.linkedin.com/oauth/v2/authorization';
const OAUTH_TOKEN = 'https://www.linkedin.com/oauth/v2/accessToken';
const FEED_UPDATE = 'https://www.linkedin.com/feed/update/';

/* Versioned APIs are dated: YYYYMM. Pinning it means a LinkedIn change to a
   newer month cannot alter the shape of what we send without a deploy. */
const DEFAULT_API_VERSION = '202609';

/*
 * w_organization_social is the scope that allows posting as the page;
 * r_organization_social reads the share statistics the stats card shows; and
 * rw_organization_admin is what makes organizationAcls answer, which is how
 * the OAuth callback works out which page this token administers. The
 * authenticated member must also hold ADMINISTRATOR, CONTENT_ADMIN or
 * DIRECT_SPONSORED_CONTENT_POSTER on the page itself — a token with all three
 * scopes but no page role still gets 403 ACCESS_DENIED, which is why the 403
 * message below talks about page roles and not about scopes.
 */
const DEFAULT_SCOPES = ['w_organization_social', 'r_organization_social', 'rw_organization_admin'];

/* LinkedIn's own limit for post commentary. Cutting here rather than letting
   LinkedIn reject the call means a slightly long post still goes out. */
const MAX_COMMENTARY = 3000;

const IMAGE_POLL_TRIES = 10;
const IMAGE_POLL_MS = 1000;

/* A Retry-After of five minutes is not something a web request can wait for;
   past this we give up and let the post be retried from the dashboard. */
const RETRY_CAP_MS = 10 * 1000;

const API_TIMEOUT_MS = 15000;
const UPLOAD_TIMEOUT_MS = 30000;

/*
 * In a dry run there is no image URN, because no upload happened. The payload
 * still shows a `content` block so the person reading it can see that an image
 * would have been attached; the placeholder is deliberately not URN-shaped
 * enough to be mistaken for a real one if it were ever copied somewhere.
 */
const DRY_RUN_IMAGE_URN = 'urn:li:image:(uploaded-when-you-connect-linkedin)';

/* ── environment ────────────────────────────────────────────────────────── */

function envToken() {
  return String(process.env.LINKEDIN_ACCESS_TOKEN || '').trim();
}

/**
 * LINKEDIN_ORG_ID may be written either way — people copy the numeric id out
 * of the page URL, or the full URN out of an API response. Accepting both
 * removes a support round trip that used to end with "oh, it needs the urn:
 * prefix" and a post that 400ed with "invalid author".
 */
function normaliseOrgUrn(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (/^urn:li:organization:/.test(raw)) return raw;
  if (/^\d+$/.test(raw)) return `urn:li:organization:${raw}`;
  return '';
}

function apiVersion() {
  return String(process.env.LINKEDIN_API_VERSION || DEFAULT_API_VERSION).trim() || DEFAULT_API_VERSION;
}

/* ── the stored connection ──────────────────────────────────────────────── */

/*
 * config() is synchronous because both callers (the agent and the /status
 * route) use it inline while building a reply, and making it async would have
 * rippled through every one of those call sites. But the token may live in
 * Mongo rather than the environment, and Mongo is not synchronous. So the
 * connection document is cached here, config() reads the cache and kicks off a
 * refresh in the background, and the asynchronous paths (publish,
 * shareStatistics) await the refresh properly before they use a token.
 *
 * The practical effect: the very first /status after a boot may say "not
 * connected" for the few milliseconds the query takes, and the next one is
 * right. Publishing is never wrong, because publishing waits.
 */
const cache = {
  loadedAt: 0,
  token: '',
  orgUrn: '',
  orgName: '',
  expiresAt: null,
};

const CONNECTION_TTL_MS = 60 * 1000;

let inFlight = null;

/**
 * Whether it is safe to query at all.
 *
 * Mongoose *buffers* commands issued while it is disconnected and arms a
 * 10-second timer for each one. In the test suite — no database, no network —
 * a single unguarded findOne would therefore leave a pending timer and Jest
 * would hang after the last assertion with "a worker process has failed to
 * exit gracefully". Asking the model's own connection whether it is ready
 * costs nothing and makes the no-database case a no-op instead.
 */
function connectionModel() {
  try {
    const Model = require('../../../models/LinkedInConnection');
    if (!Model || typeof Model.findOne !== 'function') return null;
    const state = Model.db && Model.db.readyState;
    if (state !== undefined && state !== 1) return null;
    return Model;
  } catch (e) {
    /* The model file is missing or mongoose is unhappy. The environment token
       still works, and a dry run still works; nothing here is fatal. */
    return null;
  }
}

async function loadConnection(force) {
  const fresh = !force && cache.loadedAt && (Date.now() - cache.loadedAt) < CONNECTION_TTL_MS;
  if (fresh) return cache;
  if (inFlight) return inFlight;

  inFlight = (async () => {
    const Model = connectionModel();
    if (!Model) {
      cache.loadedAt = Date.now();
      return cache;
    }
    try {
      let q = Model.findOne({ key: 'default' });
      /* accessToken is `select: false` on the schema, so it has to be asked
         for by name. That is the whole point of the schema flag: an ordinary
         read anywhere else in the app cannot accidentally carry the secret. */
      if (q && typeof q.select === 'function') q = q.select('+accessToken +refreshToken');
      if (q && typeof q.lean === 'function') q = q.lean();
      const doc = await q;
      cache.token = doc && doc.accessToken ? String(doc.accessToken) : '';
      cache.orgUrn = doc && doc.orgUrn ? String(doc.orgUrn) : '';
      cache.orgName = doc && doc.orgName ? String(doc.orgName) : '';
      cache.expiresAt = doc && doc.expiresAt ? new Date(doc.expiresAt) : null;
    } catch (e) {
      /* A database hiccup must not take publishing down: fall back to whatever
         was cached, and to the dry run if there was nothing. Never log the
         error object itself, only its message — a mongoose error can carry the
         query, and the query asked for the token field by name. */
      console.error('[linkedin-client] could not read the stored connection:', e.message);
    }
    cache.loadedAt = Date.now();
    return cache;
  })();

  try {
    return await inFlight;
  } finally {
    inFlight = null;
  }
}

function refreshInBackground() {
  if (!connectionModel()) return;
  const p = loadConnection(false);
  if (p && typeof p.catch === 'function') p.catch(() => {});
}

function daysUntil(date) {
  if (!date) return null;
  const t = new Date(date).getTime();
  if (Number.isNaN(t)) return null;
  return Math.floor((t - Date.now()) / (24 * 60 * 60 * 1000));
}

/**
 * What the dashboard is allowed to know. No token, no refresh token, not even
 * a masked one — a masked token is still four characters of a secret in a
 * screenshot, and it buys nothing that "connected, expires in 43 days" does
 * not already say.
 */
function config() {
  const version = apiVersion();
  const token = envToken();

  if (token) {
    const orgUrn = normaliseOrgUrn(process.env.LINKEDIN_ORG_ID) || cache.orgUrn;
    return {
      configured: Boolean(orgUrn),
      orgUrn,
      orgName: cache.orgName || '',
      apiVersion: version,
      source: 'env',
      /* A token pasted into the environment carries no expiry with it; we
         know only that LinkedIn's live about 60 days from issue. */
      expiresAt: null,
      expiresInDays: null,
      warning: orgUrn ? '' : 'LINKEDIN_ACCESS_TOKEN is set but LINKEDIN_ORG_ID is not, so there is no page to post as.',
    };
  }

  refreshInBackground();

  if (cache.token) {
    const orgUrn = normaliseOrgUrn(process.env.LINKEDIN_ORG_ID) || cache.orgUrn;
    const days = daysUntil(cache.expiresAt);
    let warning = '';
    if (typeof days === 'number' && days < 0) warning = 'The LinkedIn token has expired — reconnect the page to post again.';
    else if (typeof days === 'number' && days < 7) warning = `The LinkedIn token expires in ${days} day${days === 1 ? '' : 's'} — reconnect soon.`;
    else if (!orgUrn) warning = 'LinkedIn is connected but no company page is selected.';
    return {
      configured: Boolean(orgUrn),
      orgUrn,
      orgName: cache.orgName || '',
      apiVersion: version,
      source: 'db',
      expiresAt: cache.expiresAt || null,
      expiresInDays: days,
      warning,
    };
  }

  return {
    configured: false,
    orgUrn: normaliseOrgUrn(process.env.LINKEDIN_ORG_ID),
    orgName: '',
    apiVersion: version,
    source: 'none',
    expiresAt: null,
    expiresInDays: null,
    warning: '',
  };
}

/** The token and page for an outgoing call, waiting for Mongo when it must. */
async function credentials() {
  const token = envToken();
  if (token) {
    return {
      token,
      orgUrn: normaliseOrgUrn(process.env.LINKEDIN_ORG_ID) || cache.orgUrn,
      source: 'env',
    };
  }
  const c = await loadConnection(false);
  return {
    token: c.token || '',
    orgUrn: normaliseOrgUrn(process.env.LINKEDIN_ORG_ID) || c.orgUrn || '',
    source: c.token ? 'db' : 'none',
  };
}

/* ── requests ───────────────────────────────────────────────────────────── */

function headers(token, extra) {
  return Object.assign({
    Authorization: `Bearer ${token}`,
    /* Rest.li 2.0 changes how LinkedIn serialises URNs and errors. Omitting
       it gets you 1.0 responses whose fields sit in different places. */
    'X-Restli-Protocol-Version': '2.0.0',
    'Linkedin-Version': apiVersion(),
    'Content-Type': 'application/json',
  }, extra || {});
}

/**
 * Read a response once.
 *
 * Deliberately text-then-parse rather than `res.json()`: LinkedIn answers 201
 * with an empty body and answers some errors with HTML from a proxy, and
 * `res.json()` throws on both. Calling text() afterwards is not an option
 * either — with the platform fetch the body stream is already consumed.
 */
async function readBody(res) {
  let raw = '';
  try { raw = await res.text(); } catch (e) { raw = ''; }
  let json = null;
  if (raw) {
    try { json = JSON.parse(raw); } catch (e) { json = null; }
  }
  return { raw, json };
}

function headerOf(res, name) {
  try {
    if (res && res.headers && typeof res.headers.get === 'function') return res.headers.get(name);
  } catch (e) { /* a fake response without headers is not an error */ }
  return null;
}

function messageFrom(status, body) {
  const j = body && body.json;
  const text = (j && (j.message || j.error_description || j.error)) || (body && body.raw) || '';
  const trimmed = String(text).replace(/\s+/g, ' ').trim().slice(0, 300);
  return trimmed || `LinkedIn responded ${status}`;
}

/** 429, 409 and 5xx are worth exactly one more try; the rest are decisions. */
function retryable(status) {
  return status === 429 || status === 409 || (status >= 500 && status < 600);
}

/**
 * Retry-After arrives either as a number of seconds or as an HTTP date, and
 * LinkedIn uses both. Anything unparseable, absent or absurd becomes one
 * second, and everything is capped: a route that honoured a 300-second
 * Retry-After literally would hold an Express request open for five minutes
 * and time out somewhere upstream instead.
 */
function retryDelayMs(res) {
  const raw = headerOf(res, 'retry-after');
  if (!raw) return 1000;
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(RETRY_CAP_MS, Math.round(seconds * 1000));
  const at = Date.parse(raw);
  if (!Number.isNaN(at)) return Math.min(RETRY_CAP_MS, Math.max(0, at - Date.now()));
  return 1000;
}

function realSleep(ms) {
  return new Promise((resolve) => { setTimeout(resolve, ms); });
}

/* ── little text format ─────────────────────────────────────────────────── */

const RESERVED = new Set(['|', '{', '}', '@', '[', ']', '(', ')', '<', '>', '#', '\\', '*', '_', '~']);

/**
 * Escape post commentary for LinkedIn's "little text format".
 *
 * The documentation is blunt about it: every reserved character must be
 * escaped "even if those characters are not used in one of the supported
 * elements". So "Stipend: 5,000 (INR)" and "hr@ten.com" both need work, and
 * the one thing that must survive untouched is a hashtag, because `#Hiring`
 * is a supported element and `\#Hiring` renders as literal text with a
 * backslash instead of becoming a tag.
 *
 * A hashtag is `#` followed immediately by a word character. A lone `#` (as in
 * "flat #3") is not a tag and is escaped like anything else. The `@` in an
 * e-mail address is always escaped — a real mention is `@[Name](urn)`, which
 * this code never produces, so there is no case where an unescaped `@` is
 * wanted.
 *
 * Written as a single left-to-right pass rather than chained replaces
 * precisely because a chained version escapes its own backslashes: the pass
 * that handles `\` runs over the backslashes the earlier passes inserted, and
 * a post with one `(` in it comes out with `\\(`.
 */
function escapeCommentary(text) {
  const s = text == null ? '' : String(text);
  let out = '';
  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i];
    if (ch === '#') {
      const next = s[i + 1];
      if (next && /[A-Za-z0-9_]/.test(next)) { out += ch; continue; }
    }
    out += RESERVED.has(ch) ? `\\${ch}` : ch;
  }
  return out;
}

/* ── organisations ──────────────────────────────────────────────────────── */

/**
 * The page with our vanity name — the segment in
 * linkedin.com/company/the-entrepreneurship-network.
 *
 * Returns null rather than throwing on every failure: the OAuth callback tries
 * this first and falls back to listing administered pages, so a failure here
 * is a step in a sequence, not an error a person should ever see.
 */
async function resolveOrganization({ token, vanityName } = {}) {
  const vanity = String(vanityName || '').trim();
  if (!token || !vanity) return null;
  try {
    const url = `${API_BASE}/organizations?q=vanityName&vanityName=${encodeURIComponent(vanity)}`;
    const res = await httpFetch(url, { method: 'GET', headers: headers(token), timeoutMs: API_TIMEOUT_MS });
    if (!res.ok) return null;
    const body = await readBody(res);
    const elements = body.json && Array.isArray(body.json.elements) ? body.json.elements : [];
    const first = elements[0];
    if (!first) return null;
    const id = first.id != null ? String(first.id) : '';
    const urn = first.organization || first.entityUrn || (id ? `urn:li:organization:${id}` : '');
    if (!urn) return null;
    return {
      orgUrn: normaliseOrgUrn(urn) || urn,
      name: first.localizedName || first.name || '',
      vanity: first.vanityName || vanity,
    };
  } catch (e) {
    console.error('[linkedin-client] vanity lookup failed:', e.message);
    return null;
  }
}

/**
 * Every page this token may act for. Used only by the OAuth callback, as the
 * last resort when neither LINKEDIN_ORG_ID nor the vanity lookup produced a
 * page — better to connect the one page the account administers than to
 * finish the handshake with no page at all and fail at the first post.
 */
async function listAdministeredOrganizations({ token } = {}) {
  if (!token) return [];
  try {
    const url = `${API_BASE}/organizationAcls?q=roleAssignee&role=ADMINISTRATOR&state=APPROVED`;
    const res = await httpFetch(url, { method: 'GET', headers: headers(token), timeoutMs: API_TIMEOUT_MS });
    if (!res.ok) return [];
    const body = await readBody(res);
    const elements = body.json && Array.isArray(body.json.elements) ? body.json.elements : [];
    const out = [];
    for (const el of elements) {
      const urn = el && (el.organization || el.organizationalTarget);
      if (!urn) continue;
      out.push({ orgUrn: String(urn), role: el.role || '', state: el.state || '' });
    }
    return out;
  } catch (e) {
    console.error('[linkedin-client] organisation listing failed:', e.message);
    return [];
  }
}

/* ── images ─────────────────────────────────────────────────────────────── */

/**
 * initializeUpload -> PUT the bytes -> poll until AVAILABLE.
 *
 * Never throws and never returns a half-result: either `{ ok: true, imageUrn }`
 * for an image LinkedIn has finished processing, or `{ ok: false, error }`.
 * That matters because the caller's response to any failure is the same — post
 * the text without the picture — and a post that went out without its poster
 * is a far better outcome than a post that did not go out at all.
 *
 * `sleep` is injectable so the tests can walk the poll loop without ten real
 * seconds of waiting, and so no test leaves a timer behind.
 */
async function uploadImage({ token, orgUrn, png, altText, sleep, tries } = {}) {
  const wait = typeof sleep === 'function' ? sleep : realSleep;
  const attempts = Math.max(1, Number(tries) || IMAGE_POLL_TRIES);
  if (!token || !orgUrn) return { ok: false, error: 'not connected' };
  if (!png || !png.length) return { ok: false, error: 'no image bytes' };

  try {
    const init = await httpFetch(`${API_BASE}/images?action=initializeUpload`, {
      method: 'POST',
      headers: headers(token),
      body: JSON.stringify({ initializeUploadRequest: { owner: orgUrn } }),
      timeoutMs: API_TIMEOUT_MS,
    });
    const initBody = await readBody(init);
    if (!init.ok) return { ok: false, status: init.status, error: messageFrom(init.status, initBody) };

    const value = (initBody.json && initBody.json.value) || {};
    const uploadUrl = value.uploadUrl || '';
    const imageUrn = value.image || '';
    if (!uploadUrl || !imageUrn) return { ok: false, error: 'LinkedIn did not return an upload URL' };

    /*
     * The bytes go to a signed URL on a different host, so this request gets
     * the Authorization header and the image content type and nothing else —
     * sending Linkedin-Version or the Rest.li header to the upload endpoint is
     * at best ignored and at worst a signature mismatch.
     */
    const put = await httpFetch(uploadUrl, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'image/png' },
      body: png,
      timeoutMs: UPLOAD_TIMEOUT_MS,
    });
    if (!put.ok) {
      const putBody = await readBody(put);
      return { ok: false, status: put.status, error: messageFrom(put.status, putBody) };
    }

    /*
     * Processing is asynchronous. Statuses are WAITING_UPLOAD, PROCESSING,
     * AVAILABLE and PROCESSING_FAILED; only AVAILABLE may be attached to a
     * post. Attaching a PROCESSING urn is the bug this loop exists to prevent:
     * LinkedIn accepts the post, returns 201, and publishes it with a grey box
     * where the poster should be.
     */
    for (let i = 0; i < attempts; i += 1) {
      const res = await httpFetch(`${API_BASE}/images/${encodeURIComponent(imageUrn)}`, {
        method: 'GET',
        headers: headers(token),
        timeoutMs: API_TIMEOUT_MS,
      });
      const body = await readBody(res);
      const doc = (body.json && (body.json.value || body.json)) || {};
      const status = doc.status || '';
      if (status === 'AVAILABLE') return { ok: true, imageUrn, altText: String(altText || '') };
      if (status === 'PROCESSING_FAILED') return { ok: false, imageUrn, error: 'LinkedIn could not process the image' };
      if (i < attempts - 1) await wait(IMAGE_POLL_MS);
    }
    return { ok: false, imageUrn, error: 'processing timeout' };
  } catch (e) {
    return { ok: false, error: e.message || 'image upload failed' };
  }
}

/* ── posts ──────────────────────────────────────────────────────────────── */

/**
 * The exact body /rest/posts wants.
 *
 * `distribution` is required in full even though every value is the default —
 * omitting `targetEntities` or `thirdPartyDistributionChannels` is a 422 that
 * says only "missing required field". `isReshareDisabledByAuthor: false` is
 * likewise not optional. This is the one place the shape is written down, so
 * the dry-run payload and the real request can never drift apart: both call
 * this function.
 */
function buildPostBody({ orgUrn, commentary, imageUrn, altText }) {
  const body = {
    author: orgUrn,
    commentary,
    visibility: 'PUBLIC',
    distribution: {
      feedDistribution: 'MAIN_FEED',
      targetEntities: [],
      thirdPartyDistributionChannels: [],
    },
    lifecycleState: 'PUBLISHED',
    isReshareDisabledByAuthor: false,
  };
  if (imageUrn) body.content = { media: { id: imageUrn, altText: String(altText || '') } };
  return body;
}

function postUrl(urn) {
  return urn ? `${FEED_UPDATE}${urn}` : '';
}

/**
 * One attempt at creating the post. The retry decision lives in publish(),
 * because only publish() knows that an image was already uploaded and must
 * not be uploaded again on the second try.
 */
async function createPost({ token, orgUrn, commentary, imageUrn, altText } = {}) {
  if (!token || !orgUrn) return { ok: false, code: 'unconfigured', error: 'LinkedIn is not connected' };
  const body = buildPostBody({ orgUrn, commentary, imageUrn, altText });
  let res;
  try {
    res = await httpFetch(`${API_BASE}/posts`, {
      method: 'POST',
      headers: headers(token),
      body: JSON.stringify(body),
      timeoutMs: API_TIMEOUT_MS,
    });
  } catch (e) {
    /* A network error is worth retrying exactly like a 5xx is. */
    return { ok: false, code: 'network', error: e.message || 'network error', retry: true, retryAfterMs: 1000 };
  }

  if (res.ok) {
    /* The URN is in the header. The body of a 201 is empty; x-linkedin-id is
       accepted as well because older responses used that name. */
    const urn = headerOf(res, 'x-restli-id') || headerOf(res, 'x-linkedin-id') || '';
    return { ok: true, status: res.status, postUrn: urn, url: postUrl(urn), imageUrn: imageUrn || '' };
  }

  const parsed = await readBody(res);
  if (res.status === 401) {
    return {
      ok: false,
      status: 401,
      code: 'unauthorized',
      error: 'token rejected (expired or revoked) — reconnect LinkedIn',
    };
  }
  if (res.status === 403) {
    return {
      ok: false,
      status: 403,
      code: 'access_denied',
      error: 'LinkedIn refused: this account is not an administrator of the page (ACCESS_DENIED). Ask a page admin to grant the role, then reconnect.',
    };
  }
  return {
    ok: false,
    status: res.status,
    code: retryable(res.status) ? 'retryable' : 'rejected',
    error: messageFrom(res.status, parsed),
    retry: retryable(res.status),
    retryAfterMs: retryDelayMs(res),
  };
}

/**
 * Publish a post, or explain in full detail what would have been published.
 *
 * Never throws. Every failure mode — no token, a broken image, a rate limit, a
 * dead token, a LinkedIn outage — comes back as a plain object, because the
 * agent turns this straight into a sentence for a person and a status on a
 * stored post, and an exception at this layer would become a 500 on a chat
 * message with the post record stuck in 'publishing'.
 */
async function publish({ text, png, altText, sleep, tries } = {}) {
  const wait = typeof sleep === 'function' ? sleep : realSleep;
  const plain = String(text == null ? '' : text).slice(0, MAX_COMMENTARY);
  const commentary = escapeCommentary(plain);
  const imageBytes = png && png.length ? png.length : 0;

  let creds = { token: '', orgUrn: '', source: 'none' };
  try {
    creds = await credentials();
  } catch (e) {
    /* Reading the connection failed; a dry run is still a useful answer. */
    creds = { token: '', orgUrn: '', source: 'none' };
  }

  if (!creds.token || !creds.orgUrn) {
    const payload = buildPostBody({
      orgUrn: creds.orgUrn || '',
      commentary,
      imageUrn: imageBytes ? DRY_RUN_IMAGE_URN : '',
      altText,
    });
    payload.charCount = plain.length;
    payload.imageBytes = imageBytes;
    return { ok: false, dryRun: true, payload, error: '', postUrn: '', url: '', imageUrn: '' };
  }

  if (!plain.trim()) return { ok: false, dryRun: false, error: 'there is no text to post' };

  let imageUrn = '';
  let imageSkipped = '';
  if (imageBytes) {
    const up = await uploadImage({ token: creds.token, orgUrn: creds.orgUrn, png, altText, sleep: wait, tries });
    if (up.ok) {
      imageUrn = up.imageUrn;
    } else if (up.status === 401) {
      /* A dead token will not get better on the text-only path either. */
      return { ok: false, dryRun: false, code: 'unauthorized', error: 'token rejected (expired or revoked) — reconnect LinkedIn' };
    } else {
      /* Anything else about the picture: post the words. A placement story
         without its poster is still the placement story. */
      imageSkipped = up.error || 'image upload failed';
      console.error('[linkedin-client] posting without the poster:', imageSkipped);
    }
  }

  const args = { token: creds.token, orgUrn: creds.orgUrn, commentary, imageUrn, altText };
  let attempt = await createPost(args);
  if (!attempt.ok && attempt.retry) {
    await wait(Math.min(RETRY_CAP_MS, attempt.retryAfterMs || 1000));
    attempt = await createPost(args);
  }

  if (attempt.ok) {
    const out = {
      ok: true,
      dryRun: false,
      postUrn: attempt.postUrn || '',
      url: attempt.url || '',
      imageUrn,
      error: '',
    };
    if (imageSkipped) out.imageSkipped = imageSkipped;
    return out;
  }

  const failed = {
    ok: false,
    dryRun: false,
    code: attempt.code || 'rejected',
    status: attempt.status || 0,
    error: attempt.error || 'LinkedIn refused the post',
  };
  if (imageSkipped) failed.imageSkipped = imageSkipped;
  return failed;
}

/* ── statistics ─────────────────────────────────────────────────────────── */

/**
 * Page-level share statistics, or null. Null rather than an error object
 * because the only caller renders "LinkedIn did not return statistics just
 * now" for every failure — the numbers are a nice-to-have on a card, and no
 * failure to fetch them is worth interrupting anyone over.
 */
async function shareStatistics({ orgUrn } = {}) {
  try {
    const creds = await credentials();
    const org = normaliseOrgUrn(orgUrn) || orgUrn || creds.orgUrn;
    if (!creds.token || !org) return null;
    const url = `${API_BASE}/organizationalEntityShareStatistics?q=organizationalEntity&organizationalEntity=${encodeURIComponent(org)}`;
    const res = await httpFetch(url, { method: 'GET', headers: headers(creds.token), timeoutMs: API_TIMEOUT_MS });
    if (!res.ok) return null;
    const body = await readBody(res);
    return body.json || null;
  } catch (e) {
    console.error('[linkedin-client] shareStatistics failed:', e.message);
    return null;
  }
}

/* ── OAuth ──────────────────────────────────────────────────────────────── */

/**
 * Where to send someone to authorise the page. `state` is generated and stored
 * in the session by the route; it is passed through here untouched so that
 * this function stays pure and testable, and so there is exactly one place
 * (the route) that decides what counts as a valid callback.
 */
function oauthUrl({ clientId, redirectUri, state, scopes } = {}) {
  const list = Array.isArray(scopes) && scopes.length ? scopes : DEFAULT_SCOPES;
  const params = [
    'response_type=code',
    `client_id=${encodeURIComponent(String(clientId || ''))}`,
    `redirect_uri=${encodeURIComponent(String(redirectUri || ''))}`,
    `state=${encodeURIComponent(String(state || ''))}`,
    `scope=${encodeURIComponent(list.join(' '))}`,
  ];
  return `${OAUTH_AUTHORIZE}?${params.join('&')}`;
}

/**
 * Swap the authorization code for a token.
 *
 * Form-encoded, not JSON: LinkedIn's token endpoint answers a JSON request
 * with "unsupported_grant_type", which reads like the grant is wrong when the
 * content type is. Returns null on anything that is not a token, and the
 * error path never includes the body — a failed token exchange can echo the
 * client secret back in its error description.
 */
async function exchangeCode({ code, clientId, clientSecret, redirectUri } = {}) {
  if (!code || !clientId || !clientSecret || !redirectUri) return null;
  const form = [
    'grant_type=authorization_code',
    `code=${encodeURIComponent(String(code))}`,
    `client_id=${encodeURIComponent(String(clientId))}`,
    `client_secret=${encodeURIComponent(String(clientSecret))}`,
    `redirect_uri=${encodeURIComponent(String(redirectUri))}`,
  ].join('&');
  try {
    const res = await httpFetch(OAUTH_TOKEN, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form,
      timeoutMs: API_TIMEOUT_MS,
    });
    const body = await readBody(res);
    if (!res.ok || !body.json || !body.json.access_token) {
      console.error('[linkedin-client] token exchange failed with status', res.status);
      return null;
    }
    const j = body.json;
    /* The stored connection is stale the moment a new token arrives. */
    cache.loadedAt = 0;
    return {
      accessToken: j.access_token,
      expiresIn: Number(j.expires_in) || 0,
      refreshToken: j.refresh_token || '',
      refreshTokenExpiresIn: Number(j.refresh_token_expires_in) || 0,
      scope: j.scope || '',
    };
  } catch (e) {
    console.error('[linkedin-client] token exchange failed:', e.message);
    return null;
  }
}

module.exports = {
  config,
  headers,
  escapeCommentary,
  resolveOrganization,
  listAdministeredOrganizations,
  uploadImage,
  createPost,
  publish,
  shareStatistics,
  oauthUrl,
  exchangeCode,
  DEFAULT_SCOPES,
  API_BASE,
};
