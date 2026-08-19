'use strict';

/**
 * @fileoverview One HTTP call that works on every Node this app might run on.
 *
 * The bug this exists to kill: every job source was written against the global
 * `fetch`, which only exists from Node 18. Production runs older than that, so
 * every source failed with "fetch is not defined" and the portal reported zero
 * openings — while the same code passed on a developer machine running Node
 * 26. Nine sources, one missing global, and the symptom looked like "the
 * boards are down".
 *
 * `AbortSignal.timeout` has the same problem (Node 17.3+), so it is not used
 * here either. Timeouts are plain socket timeouts.
 *
 * Modern Node still gets the native implementation — this only fills the gap
 * when it must, and presents the small slice of the fetch API the callers
 * actually use: ok, status, url, headers.get, json(), text().
 */

const https = require('https');
const http = require('http');
const { URL } = require('url');

const MAX_REDIRECTS = 5;

/**
 * The fetch-shaped response the callers expect. Deliberately minimal: adding
 * surface here would invite code that works on new Node and breaks on old,
 * which is the exact failure being fixed.
 */
function makeResponse({ status, body, finalUrl, headers }) {
  return {
    ok: status >= 200 && status < 300,
    status,
    url: finalUrl,
    headers: {
      get: (name) => headers[String(name).toLowerCase()] || null,
    },
    text: async () => body,
    json: async () => JSON.parse(body),
  };
}

/** One request, following redirects by hand because the shim must. */
function request(url, options, redirectsLeft) {
  const opts = options || {};
  return new Promise((resolve, reject) => {
    let parsed;
    try { parsed = new URL(url); } catch (e) { reject(new Error('bad url')); return; }

    const lib = parsed.protocol === 'https:' ? https : http;
    const req = lib.request({
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method: opts.method || 'GET',
      headers: opts.headers || {},
    }, (res) => {
      const status = res.statusCode;

      /* Redirects: fetch follows them, so the shim must too — and the URL the
         caller reads back has to be where it actually landed, because that is
         how a board link is recognised as having left the board. */
      if (status >= 300 && status < 400 && res.headers.location && redirectsLeft > 0) {
        res.resume(); /* drain, or the socket leaks */
        const next = new URL(res.headers.location, url).toString();
        /* A redirected POST becomes a GET, exactly as browsers do it. */
        const method = (opts.method || 'GET').toUpperCase();
        const nextOpts = (status === 303 || ((status === 301 || status === 302) && method === 'POST'))
          ? Object.assign({}, opts, { method: 'GET', body: undefined })
          : opts;
        resolve(request(next, nextOpts, redirectsLeft - 1));
        return;
      }

      /* HEAD has no body and must not wait for one. */
      if ((opts.method || 'GET').toUpperCase() === 'HEAD') {
        res.resume();
        resolve(makeResponse({ status, body: '', finalUrl: url, headers: res.headers }));
        return;
      }

      let raw = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { raw += chunk; });
      res.on('end', () => resolve(makeResponse({ status, body: raw, finalUrl: url, headers: res.headers })));
    });

    req.on('error', reject);

    /* A plain socket timeout: available on every Node, unlike AbortSignal. */
    const ms = opts.timeoutMs || 8000;
    req.setTimeout(ms, () => { req.destroy(new Error(`timeout after ${ms}ms`)); });

    if (opts.body) req.write(opts.body);
    req.end();
  });
}

/**
 * fetch(url, { method, headers, body, timeoutMs, redirect }).
 *
 * Uses the platform's own fetch when there is one — that path is better
 * tested than anything here — and falls back otherwise.
 */
async function httpFetch(url, options) {
  const opts = options || {};

  if (typeof globalThis.fetch === 'function') {
    const init = {
      method: opts.method || 'GET',
      headers: opts.headers,
      body: opts.body,
      redirect: opts.redirect || 'follow',
    };
    /* Only wire an abort signal where the API exists. */
    if (opts.timeoutMs && typeof AbortController === 'function') {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
      init.signal = controller.signal;
      try {
        return await globalThis.fetch(url, init);
      } finally {
        clearTimeout(timer);
      }
    }
    return globalThis.fetch(url, init);
  }

  return request(url, opts, opts.redirect === 'manual' ? 0 : MAX_REDIRECTS);
}

module.exports = { httpFetch };
