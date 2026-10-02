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
  const maxBytes = opts.maxBytes || 2 * 1024 * 1024;
  return new Promise((resolve, reject) => {
    let parsed;
    try { parsed = new URL(url); } catch (e) { reject(new Error('bad url')); return; }

    /* Every exit from this request goes through settle(), so the deadline
       timer below is always cleared — whichever way the request ends. */
    let hard = null;
    const settle = (fn) => { if (hard) clearTimeout(hard); fn(); };

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
        settle(() => resolve(request(next, nextOpts, redirectsLeft - 1)));
        return;
      }

      /* HEAD has no body and must not wait for one. */
      if ((opts.method || 'GET').toUpperCase() === 'HEAD') {
        res.resume();
        settle(() => resolve(makeResponse({ status, body: '', finalUrl: url, headers: res.headers })));
        return;
      }

      let raw = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        raw += chunk;
        /* A body with no ceiling is a memory leak with a URL. One college
           serving a huge file would grow this string until the process died,
           and pm2 restarting mid-run is what turns a stuck agent into a
           failed dashboard request. Truncation is fine: every caller here
           reads a contact block near the top. */
        if (raw.length > maxBytes) {
          raw = raw.slice(0, maxBytes);
          res.destroy();
          settle(() => resolve(makeResponse({ status, body: raw, finalUrl: url, headers: res.headers })));
        }
      });
      res.on('end', () => settle(() => resolve(makeResponse({ status, body: raw, finalUrl: url, headers: res.headers }))));
      res.on('error', () => settle(() => resolve(makeResponse({ status, body: raw, finalUrl: url, headers: res.headers }))));
    });

    req.on('error', (e) => settle(() => reject(e)));

    const ms = opts.timeoutMs || 8000;

    /*
     * TWO timers, because one is not enough.
     *
     * `req.setTimeout` is an IDLE timeout: every byte that arrives resets it.
     * A server that dribbles one byte every few seconds keeps it alive
     * forever, and the request never ends — which is precisely how the
     * college agent sat at "370 of 371" with one worker that would never
     * return. `hard` is the deadline that does not move.
     */
    /* Both say "timeout": callers match on the word, and which of the two
       timers fired is detail they should not have to know. */
    req.setTimeout(ms, () => { req.destroy(new Error(`timeout (idle) after ${ms}ms`)); });
    hard = setTimeout(() => { req.destroy(new Error(`timeout (deadline) after ${ms}ms`)); }, ms);
    if (typeof hard.unref === 'function') hard.unref();

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
      /*
       * The timer is deliberately NOT cleared when fetch() resolves.
       *
       * fetch settles as soon as the RESPONSE HEADERS arrive — the body is
       * read afterwards, by the caller, with `res.text()`. Clearing the timer
       * here left that read with no deadline at all, so a server that sent
       * headers and then dribbled kept the request alive indefinitely. That
       * is the hang: one college, one worker, "370 of 371" forever.
       *
       * Firing on an already-consumed response is a no-op, and unref keeps a
       * pending timer from holding the process open.
       */
      if (typeof timer.unref === 'function') timer.unref();
      init.signal = controller.signal;
      return globalThis.fetch(url, init);
    }
    return globalThis.fetch(url, init);
  }

  return request(url, opts, opts.redirect === 'manual' ? 0 : MAX_REDIRECTS);
}

module.exports = { httpFetch };
