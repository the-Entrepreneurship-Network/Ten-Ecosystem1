'use strict';

/**
 * The dashboard must not rate-limit itself.
 *
 * It answered "Request failed — HTTP 429 Too Many Requests" and the contacts
 * list came back empty. Two causes, both real:
 *
 *   1. `rateLimitKey` knew about students, HR, coordinators and admins but
 *      NOT the Growth OS, so every request from the dashboard fell through to
 *      the IP bucket. The operator was being counted as an anonymous stranger
 *      sharing one allowance with everyone behind that address.
 *
 *   2. Progress polling. A second three-second poll was added when sends got
 *      a progress line, and two of them is 600 requests a quarter-hour
 *      against a limit of 300 — blown after seven and a half minutes, which
 *      is less than one send of 200 takes to finish.
 *
 * The limiter's own comment already states the principle: read-only polling
 * is not what it exists to stop. These are the tests that keep that true, and
 * keep the skip narrow enough that the writes are still counted.
 */

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '../..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const code = (rel) => read(rel)
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

const server = code('server.js');

/** The skip predicate, lifted out of server.js and run for real. */
function skipFor() {
  const src = server.slice(server.indexOf('const apiLimiter = rateLimit({'));
  const m = src.match(/skip:\s*\(req\)\s*=>\s*([\s\S]*?),\n\s*message:/);
  if (!m) throw new Error('could not find the limiter skip predicate');
  // eslint-disable-next-line no-new-func
  return new Function('req', 'return (' + m[1] + ');');
}

describe('a signed-in Growth operator is a person, not an IP', () => {
  const keyFn = server.slice(server.indexOf('function rateLimitKey'),
                             server.indexOf('const apiLimiter'));

  test('the growth session is part of the identity', () => {
    expect(keyFn).toMatch(/ses\.growthUser && ses\.growthUser\.username/);
  });

  test('it reads the session property the login actually writes', () => {
    // routes/growth.js sets req.session.growthUser on sign-in. A key that
    // reads any other name silently falls back to the IP and the bug returns.
    expect(code('routes/growth.js')).toMatch(/req\.session\.growthUser = \{ username/);
    expect(keyFn).toMatch(/growthUser/);
  });

  test('an anonymous caller still falls back to the IP', () => {
    expect(keyFn).toMatch(/ip:\$\{ipKeyGenerator\(req\.ip\)\}/);
  });

  test('every signed-in role is still keyed by identity', () => {
    ['student', 'hr', 'coordinator', 'adminUser', 'growthUser']
      .forEach((role) => expect(keyFn).toContain('ses.' + role));
  });
});

describe('a progress poll is a read, and reads are not counted', () => {
  const skip = skipFor();
  const get = (p) => skip({ method: 'GET', path: p });
  const post = (p) => skip({ method: 'POST', path: p });

  test.each([
    ['/growth/colleges/agent/status'],
    ['/growth/colleges/send/status'],
    ['/api/growth/colleges/agent/status'],
  ])('%s is not counted', (p) => expect(get(p)).toBe(true));

  /*
   * The narrowness is the point. Skipping the limiter is a real concession,
   * so it buys exactly two read-only paths and nothing adjacent to them.
   */
  test.each([
    ['/growth/colleges/send'],
    ['/growth/colleges/agent/run'],
    ['/growth/colleges'],
    ['/growth/campaigns'],
    ['/growth/colleges/send/status/extra'],
    ['/growth/colleges/discover'],
  ])('%s is still counted', (p) => expect(get(p)).toBe(false));

  test('a POST to a status path is still counted', () => {
    // The skip is GET-only, so nothing that changes state can slip through
    // by borrowing a read-only URL.
    expect(post('/growth/colleges/send/status')).toBe(false);
  });

  test('the notification polls it already skipped are untouched', () => {
    expect(get('/notifications/feed')).toBe(true);
    expect(get('/v2/messages/threads')).toBe(true);
  });

  test('the paths it skips are behind the Growth sign-in', () => {
    const r = code('routes/growth.js');
    expect(r).toMatch(/api\.get\('\/colleges\/send\/status', requireGrowthAPI/);
    expect(r).toMatch(/api\.get\('\/colleges\/agent\/status', requireGrowthAPI/);
  });
});

describe('the dashboard asks less often', () => {
  const html = read('public/growth-os.html');

  test('there is ONE poll interval, not a number copied into each loop', () => {
    expect(html).toMatch(/var POLL_MS = \d+;/);
    expect(html).toMatch(/setTimeout\(pollAgent, POLL_MS\)/);
    expect(html).toMatch(/setTimeout\(pollSend, POLL_MS\)/);
  });

  test('two polls at that interval stay inside the allowance even if counted', () => {
    const ms = Number(html.match(/var POLL_MS = (\d+);/)[1]);
    const max = Number(code('server.js').match(/RATE_AUTH_USER_MAX\)\s*\n?\s*:\s*(\d+)/)[1]);
    const windowMin = 15;
    const perWindow = 2 * (windowMin * 60 * 1000) / ms;
    expect(perWindow).toBeLessThan(max * 2);   // 360 vs 300: safe only because
    expect(ms).toBeGreaterThanOrEqual(5000);   // they are also skipped above
  });

  test('polling stops when nothing is running', () => {
    // The loops reschedule only while a job is live, so an idle dashboard
    // makes no requests at all.
    const agent = html.slice(html.indexOf('async function pollAgent'));
    expect(agent.slice(0, 500)).toMatch(/if \(st\.running\) \{ setTimeout\(pollAgent/);
    const send = html.slice(html.indexOf('async function pollSend'));
    expect(send.slice(0, 1400)).toMatch(/if \(st\.running\) \{ setTimeout\(pollSend/);
  });
});

describe('a 429 says so', () => {
  test('the dashboard reports the status instead of "Request failed"', () => {
    // This is how the cause was visible at all: the generic message had been
    // replaced with one that names the HTTP status.
    const html = read('public/growth-os.html');
    const at = html.indexOf('async function call(');
    expect(html.slice(at, at + 1400)).toMatch(/HTTP ' \+ res\.status/);
  });
});
