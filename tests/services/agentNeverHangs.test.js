'use strict';

/**
 * A run must always end.
 *
 * The dashboard sat at "Visiting 370 of 371 — found 38" with the bar full and
 * the button still saying "Running…". One worker was inside a fetch that would
 * never return, so `running` stayed true forever and nothing else could be
 * trusted — including, most likely, the Send that answered "Request failed",
 * because a request that never finishes is also a body that never stops
 * growing.
 *
 * Three guards, tested where each one actually bites: a total deadline on the
 * HTTP call, a cap on the body it will accumulate, and a deadline on the whole
 * college so the loop's promise cannot outlive the run whatever the HTTP layer
 * does next.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '../..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const code = (rel) => read(rel)
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

/* Read at module load, so it must be set before the require below. The
   DEFAULT is asserted separately, from source — this only keeps the suite
   from spending ninety seconds proving a four-second point. */
process.env.COLLEGE_DEADLINE_MS = '4000';

const { httpFetch } = require('../../services/v2/httpFetch');
const discovery = require('../../services/collegeDiscovery');

/** A server that answers, then never shuts up. */
function dribbler() {
  const timers = [];
  const srv = http.createServer((req, res) => {
    if (req.url === '/dribble') {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.write('<html>');
      timers.push(setInterval(() => { try { res.write('.'); } catch (_) { /* gone */ } }, 50));
    } else if (req.url === '/huge') {
      res.writeHead(200, { 'content-type': 'text/html' });
      const blast = () => {
        if (res.writableEnded || res.destroyed) return;
        for (let i = 0; i < 20; i++) res.write('x'.repeat(50000));
        timers.push(setTimeout(blast, 0));
      };
      blast();
    } else {
      res.end('<html>ok</html>');
    }
  });
  srv.stopAll = () => { timers.forEach((t) => { clearInterval(t); clearTimeout(t); }); srv.close(); };
  return srv;
}

describe('an HTTP call always comes back', () => {
  let srv, base;

  beforeAll((done) => {
    srv = dribbler();
    srv.listen(0, () => { base = 'http://127.0.0.1:' + srv.address().port; done(); });
  });
  afterAll(() => srv.stopAll());

  test('a normal page still works', async () => {
    const r = await httpFetch(base + '/ok', { timeoutMs: 3000 });
    expect(await r.text()).toContain('ok');
  });

  /*
   * The hang itself. The headers arrive immediately, so the request "succeeds"
   * and only the BODY never ends. On the native path the abort timer was being
   * cleared the moment fetch() resolved — which is before a single byte of
   * body is read. On the shim path req.setTimeout is an IDLE timeout that
   * every dribbled byte resets. Neither had a deadline that could not move.
   */
  test('a server that dribbles forever is given up on', async () => {
    const started = Date.now();
    await expect((async () => {
      const r = await httpFetch(base + '/dribble', { timeoutMs: 1200 });
      return r.text();
    })()).rejects.toThrow();
    expect(Date.now() - started).toBeLessThan(6000);
  }, 15000);

  /*
   * A body with no ceiling is a memory leak with a URL, and pm2 restarting an
   * out-of-memory process mid-run is the likeliest reason a dashboard request
   * comes back as a bare "Request failed".
   *
   * The two paths bound it differently and both are correct: the shim stops
   * at maxBytes and returns what it has, the native path has no maxBytes to
   * honour and is stopped by the deadline. The test asserts the property that
   * matters to both — it ends, quickly, without swallowing the server.
   */
  test('an enormous body is bounded, by the cap or by the deadline', async () => {
    const started = Date.now();
    let length = null;
    try {
      const r = await httpFetch(base + '/huge', { timeoutMs: 2500, maxBytes: 100000 });
      length = (await r.text()).length;
    } catch (_) {
      length = null;                       // aborted by the deadline — also bounded
    }
    expect(Date.now() - started).toBeLessThan(10000);
    if (length !== null) expect(length).toBeLessThanOrEqual(100000);
  }, 20000);
});

describe('the abort deadline is not cancelled when the headers arrive', () => {
  const src = code('services/v2/httpFetch.js');

  test('the native path does not clear the timer in a finally', () => {
    const fn = src.slice(src.indexOf('async function httpFetch'));
    expect(fn).toMatch(/setTimeout\(\(\) => controller\.abort\(\), opts\.timeoutMs\)/);
    // This is the bug: fetch() settles on HEADERS, so clearing here left the
    // body read with no deadline at all.
    expect(fn).not.toMatch(/finally\s*\{\s*clearTimeout/);
  });

  test('the shim has a deadline as well as an idle timeout', () => {
    const fn = src.slice(src.indexOf('function request('), src.indexOf('async function httpFetch'));
    expect(fn).toMatch(/req\.setTimeout\(ms/);          // idle — reset by every byte
    expect(fn).toMatch(/hard = setTimeout\(/);           // total — does not move
    expect(fn).toMatch(/timeout \(deadline\) after \$\{ms\}ms/);
  });

  test('the shim caps what it will accumulate', () => {
    const fn = src.slice(src.indexOf('function request('), src.indexOf('async function httpFetch'));
    expect(fn).toMatch(/raw\.length > maxBytes/);
    expect(fn).toMatch(/res\.destroy\(\)/);
  });

  test('every exit clears the deadline, so it cannot fire on a finished request', () => {
    const fn = src.slice(src.indexOf('function request('), src.indexOf('async function httpFetch'));
    expect(fn).toMatch(/const settle = \(fn\) => \{ if \(hard\) clearTimeout\(hard\); fn\(\); \}/);
    expect((fn.match(/settle\(\(\) =>/g) || []).length).toBeGreaterThanOrEqual(4);
  });
});

describe('a run always finishes', () => {
  /*
   * The headline guarantee, and the reason it is a second guard rather than
   * trust in the one above: the promise being raced is the WHOLE college —
   * every fetch, every parse, every write. Whatever hangs inside it, the loop
   * moves on.
   */
  test('a college that never returns is given up on, and the run ends', async () => {
    const started = Date.now();
    const status = await discovery.runBulk(['a.ac.in', 'b.ac.in', 'hangs.ac.in'], {
      discover: (site) => (site === 'hangs.ac.in'
        ? new Promise(() => { /* never settles, exactly like the live hang */ })
        : Promise.resolve([])),
      save: async () => ({ added: 1, skipped: 0 })
    });

    expect(status.running).toBe(false);          // the bug was: true, forever
    expect(status.processed).toBe(status.total); // the bug was: 370 of 371
    expect(status.failed).toBe(1);
    expect(status.finishedAt).toBeTruthy();
    expect(Date.now() - started).toBeLessThan(discovery.COLLEGE_DEADLINE_MS + 20000);
  }, 180000);

  test('the DEFAULT deadline is long enough for an honestly slow college', () => {
    /* Eight paths at the fetch timeout, plus the politeness delay between
       them, is the worst HONEST case. The shipped default must sit above it
       or the agent would start failing colleges that were merely slow. Read
       from source, because this file overrides the live value above. */
    const src = code('services/collegeDiscovery.js');
    const shipped = Number((src.match(/COLLEGE_DEADLINE_MS, 10\) \|\| (\d+)/) || [])[1]);
    const timeout = Number((src.match(/COLLEGE_FETCH_TIMEOUT_MS, 10\) \|\| (\d+)/) || [])[1]);
    const delay = Number((src.match(/COLLEGE_PATH_DELAY_MS, 10\) \|\| (\d+)/) || [])[1]);
    const paths = (discovery.PATHS || []).length;
    expect(shipped).toBeGreaterThan(paths * timeout + paths * delay);
  });

  test('the deadline timer is NOT unref\'d — it is the thing making progress', () => {
    /*
     * Caught by running it: a hung college holds no socket and no handle, so
     * with an unref'd deadline the process fell idle and exited with the run
     * still marked running. The timer is cleared on settle, so it holds the
     * loop for at most one deadline.
     */
    const src = code('services/collegeDiscovery.js');
    const fn = src.slice(src.indexOf('function withDeadline'), src.indexOf('/** A snapshot'));
    expect(fn).not.toMatch(/timer\.unref/);
    expect(fn).toMatch(/clearTimeout\(timer\)/);
  });

  test('the loser of the race is abandoned, never awaited', () => {
    const src = code('services/collegeDiscovery.js');
    expect(src).toMatch(/Promise\.race\(/);
    const worker = src.slice(src.indexOf('async function worker'));
    expect(worker).toMatch(/withDeadline\(\s*discover\(/);
  });
});

describe('the dashboard says what actually went wrong', () => {
  const html = read('public/growth-os.html');

  test('a reply with no error names the HTTP status instead of "Request failed"', () => {
    // The app always answers with an `error`, so a reply without one did not
    // come from the app: it is nginx, 502 while the process restarts or 504
    // when it is wedged. "Request failed" hid exactly the useful part.
    const at = html.indexOf('async function call(');
    const fn = html.slice(at, at + 1400);
    expect(fn).toMatch(/HTTP ' \+ res\.status/);
    expect(fn).toMatch(/502/);
    expect(fn).toMatch(/504/);
  });

  test('a real error from the app is still shown as written', () => {
    const at = html.indexOf('async function call(');
    expect(html.slice(at, at + 1400)).toMatch(/data\.error\s*\n?\s*\|\|/);
  });
});
