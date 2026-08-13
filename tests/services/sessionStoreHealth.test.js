'use strict';

/**
 * The database health flag, and why the HR portal kept signing itself out.
 *
 * Sessions live in MongoDB when it is reachable and in process memory when it
 * is not. Which store is in use is decided by this flag — and it used to be a
 * ONE-WAY DOOR.
 *
 * `isNetworkError` sets it for any query error whose message merely contains
 * "connection", "network" or "timeout". The only things that cleared it were
 * mongoose's 'connected' and 'reconnected' events, which never fire if the
 * socket did not actually drop. So a single slow query that timed out moved
 * every session in the portal to in-process memory permanently:
 *
 *   - sessions already stored in Mongo became unreadable, so everyone was
 *     signed out at once;
 *   - every session created afterwards died at the next restart or deploy;
 *   - under PM2 with more than one worker, each worker had its own copy, so a
 *     signed-in person was signed out on roughly every other request.
 *
 * These tests pin the recovery. The functions are lifted out of server.js, so
 * they cannot drift from what the server actually runs.
 */

const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.join(__dirname, '../../server.js'), 'utf8');

function lift(name) {
  const start = source.indexOf(`function ${name}(`);
  if (start === -1) throw new Error(`${name} not found in server.js`);
  let depth = 0, i = source.indexOf('{', start);
  for (; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') { depth--; if (depth === 0) break; }
  }
  return source.slice(start, i + 1);
}

const TTL_MATCH = source.match(/const MONGO_UNHEALTHY_TTL_MS = ([^;]+);/);

/** Rebuild the two functions against a fake mongoose we control. */
function build(readyState) {
  const mongoose = { connection: { readyState } };
  // eslint-disable-next-line no-new-func
  const ctx = new Function('mongoose', 'global', `
    const MONGO_UNHEALTHY_TTL_MS = ${TTL_MATCH[1]};
    ${lift('markMongoUnhealthy')}
    ${lift('isMongoHealthy')}
    return { markMongoUnhealthy, isMongoHealthy, MONGO_UNHEALTHY_TTL_MS };
  `);
  const fakeGlobal = { isMongoUnhealthy: false, lastMongoCheckTime: 0 };
  return Object.assign(ctx(mongoose, fakeGlobal), { g: fakeGlobal, mongoose });
}

const CONNECTED = 1;
const DISCONNECTED = 0;

describe('a connected database is healthy', () => {
  it('reports healthy when nothing has gone wrong', () => {
    expect(build(CONNECTED).isMongoHealthy()).toBe(true);
  });

  it('reports unhealthy while the socket is actually down', () => {
    expect(build(DISCONNECTED).isMongoHealthy()).toBe(false);
  });

  it('stays unhealthy while down, however long ago the failure was', () => {
    const s = build(DISCONNECTED);
    s.markMongoUnhealthy();
    s.g.lastMongoCheckTime = Date.now() - 60 * 60 * 1000;
    // readyState is the authority. An expired observation must not paper over
    // a genuinely dead connection.
    expect(s.isMongoHealthy()).toBe(false);
  });
});

describe('a failure observation expires — the flag is not a one-way door', () => {
  it('is honoured immediately after a failure', () => {
    const s = build(CONNECTED);
    s.markMongoUnhealthy();
    expect(s.isMongoHealthy()).toBe(false);
  });

  it('recovers by itself once the observation is older than the TTL', () => {
    // THE BUG. Without this, one timed-out query kept the process in
    // memory-session mode until somebody restarted it — and every restart
    // signed everyone out again.
    const s = build(CONNECTED);
    s.markMongoUnhealthy();
    s.g.lastMongoCheckTime = Date.now() - (s.MONGO_UNHEALTHY_TTL_MS + 1000);
    expect(s.isMongoHealthy()).toBe(true);
  });

  it('clears the flag when it recovers, so later checks are cheap', () => {
    const s = build(CONNECTED);
    s.markMongoUnhealthy();
    s.g.lastMongoCheckTime = Date.now() - (s.MONGO_UNHEALTHY_TTL_MS + 1000);
    s.isMongoHealthy();
    expect(s.g.isMongoUnhealthy).toBe(false);
  });

  it('does not recover early, so a burst of failures is not hammered', () => {
    const s = build(CONNECTED);
    s.markMongoUnhealthy();
    s.g.lastMongoCheckTime = Date.now() - Math.floor(s.MONGO_UNHEALTHY_TTL_MS / 2);
    expect(s.isMongoHealthy()).toBe(false);
  });

  it('handles a missing timestamp by re-testing rather than latching', () => {
    // A flag set by the mongoose event handlers carries no timestamp. It must
    // not mean "unhealthy forever".
    const s = build(CONNECTED);
    s.g.isMongoUnhealthy = true;
    s.g.lastMongoCheckTime = 0;
    expect(s.isMongoHealthy()).toBe(true);
  });
});

describe('the session store no longer caps every session at 30 minutes', () => {
  it('does not pass a fixed ttl to connect-mongo', () => {
    // `ttl: 1800` applied to EVERY session regardless of its cookie, so the
    // 24-hour student session that notification links depend on was silently
    // reduced to 30 minutes: the cookie promised a day and the store deleted
    // the document after half an hour. With no ttl, connect-mongo uses each
    // session's own cookie.expires.
    const storeBlock = source.slice(source.indexOf('MongoStore.create('),
                                    source.indexOf('MongoStore.create(') + 700);
    expect(storeBlock).not.toMatch(/\bttl\s*:/);
    expect(storeBlock).toMatch(/collectionName:\s*'sessions'/);
  });

  it('decides on readyState, not on the latching flag', () => {
    // The method DEFINITION, not the call site inside _getStore().
    const at = source.indexOf('_mongoReady() {');
    expect(at).toBeGreaterThan(-1);
    const body = source.slice(at, source.indexOf('}', at) + 1);
    expect(body).toMatch(/readyState === 1/);
    // Consulting the latching flag here is precisely what made one timed-out
    // query move every session into memory for good.
    expect(body).not.toMatch(/isMongoUnhealthy/);
  });
});
