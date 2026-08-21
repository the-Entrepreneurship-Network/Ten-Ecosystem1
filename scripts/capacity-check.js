#!/usr/bin/env node
'use strict';

/**
 * How much can this server actually take?
 *
 * Answers three questions with measurements rather than guesses:
 *
 *   1. What is the machine, and what is the app configured to use of it?
 *   2. How many requests per second does it really serve, and at what latency?
 *   3. From that: how many interns can be using it at once, and how fast can
 *      they register?
 *
 *   node scripts/capacity-check.js
 *   node scripts/capacity-check.js --load https://your-site/api/public/stats
 *   node scripts/capacity-check.js --load <url> --users 50 --seconds 20
 *
 * The report is read-only. The load test sends real GET requests to the URL you
 * name, so point it at a public read endpoint, not at anything that writes.
 */

const os = require('os');
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf('--' + name);
  return i === -1 ? fallback : args[i + 1];
};
const LOAD_URL = flag('load', null);
const USERS = Number(flag('users', 25));
const SECONDS = Number(flag('seconds', 15));

const h1 = (s) => console.log('\n' + s + '\n' + '='.repeat(58));
const row = (k, v) => console.log('  ' + String(k).padEnd(30) + v);
const warn = (m) => console.log('  \x1b[33m!\x1b[0m ' + m);
const bad = (m) => console.log('  \x1b[31m✗\x1b[0m ' + m);
const ok = (m) => console.log('  \x1b[32m✓\x1b[0m ' + m);

// ── 1. the machine, and what the app takes of it ───────────────────────────
function reportMachine() {
  h1('1. The machine');
  const cores = os.cpus().length;
  const totalGb = os.totalmem() / 1e9;
  const freeGb = os.freemem() / 1e9;
  row('CPU cores', cores);
  row('RAM', `${totalGb.toFixed(1)} GB total, ${freeGb.toFixed(1)} GB free`);
  row('Load average (1/5/15m)', os.loadavg().map((n) => n.toFixed(2)).join(' / '));
  row('Uptime', (os.uptime() / 3600).toFixed(1) + ' h');

  const load1 = os.loadavg()[0];
  if (load1 > cores) bad(`Load ${load1.toFixed(2)} exceeds ${cores} core(s) — the machine is already saturated.`);
  else if (load1 > cores * 0.7) warn(`Load ${load1.toFixed(2)} is over 70% of ${cores} core(s).`);
  else ok('CPU has headroom right now.');

  h1('2. What the app is configured to use');
  let instances = 1;
  try {
    const eco = require(path.join(__dirname, '..', 'ecosystem.config.js'));
    instances = (eco.apps && eco.apps[0] && eco.apps[0].instances) || 1;
  } catch (_e) { /* report the default */ }
  row('PM2 instances', instances);
  if (instances === 1 && cores > 1) {
    bad(`ONE process on a ${cores}-core machine — ${cores - 1} core(s) sit idle.`);
    console.log('      Node is single-threaded. This is almost always the first ceiling you hit.');
    console.log('      See "How to raise the ceiling" at the end.');
  } else if (instances !== 1) {
    ok(`Clustered across ${instances} process(es).`);
    warn('With >1 instance, in-process cron jobs run once PER instance. See the notes.');
  }

  const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const pool = (server.match(/maxPoolSize:\s*(\d+)/) || [])[1];
  row('MongoDB connection pool', pool ? `${pool} concurrent queries` : 'default (100)');
  const rlMax = (server.match(/max:\s*process\.env\.RATE_AUTH_USER_MAX[\s\S]{0,60}?:\s*(\d+)/) || [])[1];
  if (rlMax) row('Rate limit (per signed-in user)', `${rlMax} requests / 15 min  (~${(rlMax / 15).toFixed(0)}/min)`);
  const mem = (fs.readFileSync(path.join(__dirname, '..', 'ecosystem.config.js'), 'utf8')
    .match(/max_memory_restart:\s*"([^"]+)"/) || [])[1];
  if (mem) row('Restart if memory exceeds', mem);

  return { cores, instances, pool: Number(pool) || 100 };
}

// ── 2. measure it ──────────────────────────────────────────────────────────
function once(url) {
  return new Promise((resolve) => {
    const started = process.hrtime.bigint();
    const lib = url.startsWith('https:') ? https : http;
    const req = lib.get(url, { timeout: 20000 }, (res) => {
      res.resume();
      res.on('end', () => resolve({
        ms: Number(process.hrtime.bigint() - started) / 1e6, status: res.statusCode
      }));
    });
    req.on('timeout', () => { req.destroy(); resolve({ ms: 20000, status: 0 }); });
    req.on('error', () => resolve({ ms: Number(process.hrtime.bigint() - started) / 1e6, status: 0 }));
  });
}

async function loadTest(url) {
  h1(`3. Load test — ${USERS} concurrent users for ${SECONDS}s`);
  console.log('  ' + url + '\n');
  const results = [];
  const until = Date.now() + SECONDS * 1000;
  let printed = 0;

  const worker = async () => {
    while (Date.now() < until) {
      results.push(await once(url));
      if (results.length - printed >= 1000) {
        printed = results.length;
        process.stdout.write(`\r  sent ${results.length}…`);
      }
    }
  };
  await Promise.all(Array.from({ length: USERS }, worker));
  process.stdout.write('\r' + ' '.repeat(30) + '\r');

  const oks = results.filter((r) => r.status >= 200 && r.status < 400);
  const rate = results.filter((r) => r.status === 429).length;
  const fails = results.filter((r) => r.status === 0 || r.status >= 500).length;
  const times = oks.map((r) => r.ms).sort((a, b) => a - b);
  const pct = (p) => times.length ? times[Math.min(times.length - 1, Math.floor(times.length * p))].toFixed(0) + ' ms' : '—';

  // Throughput counts SERVED requests only.
  //
  // Counting everything sent is the trap: a 429 costs the app almost nothing —
  // the rate limiter rejects it before any route or query runs — so a saturated
  // limiter reports a huge, meaningless "throughput". One test run here sent
  // 32,966 requests, of which 32,667 were 429s, and the naive figure came out at
  // 2,747 req/s. The app had actually served 25.
  const rps = oks.length / SECONDS;
  const successRate = oks.length / results.length;

  row('Requests sent', results.length);
  row('Actually served', `${oks.length} (${(successRate * 100).toFixed(1)}%)`);
  row('Throughput (served)', rps.toFixed(1) + ' req/s');
  if (rate) {
    warn(`${rate} were rate-limited (429). One machine pretending to be ${USERS} users`);
    console.log('      shares one IP, so the limiter treats it as one abusive client.');
  }
  if (fails) bad(`${fails} failed or timed out.`);
  row('Latency p50', pct(0.5));
  row('Latency p95', pct(0.95));
  row('Latency p99', pct(0.99));

  return {
    rps,
    successRate,
    p95: times.length ? times[Math.floor(times.length * 0.95)] : 0,
    fails
  };
}

// ── 3. turn that into people ───────────────────────────────────────────────
function reportPeople(measured, cfg) {
  // Numbered 4 only when the load test above actually printed section 3.
  h1(`${measured ? 4 : 3}. What that means in interns`);

  if (!measured) {
    console.log('  Run again with --load <url> to measure. Without a measurement any');
    console.log('  number here would be invented, so none is given.\n');
    return;
  }

  // A run the rate limiter ate is not a capacity measurement, and dividing by
  // it would produce a confident wrong answer. Say so instead of guessing.
  if (measured.successRate < 0.8) {
    bad(`Only ${(measured.successRate * 100).toFixed(1)}% of requests were served — the rest hit the`);
    console.log('      rate limit, so this run measured the limiter, not the app.');
    console.log('');
    console.log('  Re-run it one of these ways:');
    console.log('    • lower --users (try 5) so one IP stays under the limit, or');
    console.log('    • raise the public limit for the test window in .env:');
    console.log('        RATE_PUBLIC_MAX=100000  (then pm2 restart, test, put it back)');
    console.log('');
    console.log('  Real interns come from many different IPs, so they do not hit this');
    console.log('  wall the way one test machine does.\n');
    return;
  }

  // A student reading a page, clicking, submitting: roughly one request every
  // 6 seconds while actively using the portal. Idle tabs cost nothing.
  const REQ_PER_ACTIVE_USER_PER_SEC = 1 / 6;
  const safe = measured.rps * 0.6;   // never plan to run a box at 100%
  const concurrent = Math.floor(safe / REQ_PER_ACTIVE_USER_PER_SEC);

  row('Measured throughput', measured.rps.toFixed(1) + ' req/s');
  row('Planning at 60% of that', safe.toFixed(1) + ' req/s');
  row('≈ interns using it at once', `${concurrent.toLocaleString('en-IN')}`);
  console.log('      (assuming one request per active user every ~6 seconds)');

  // Registration is a handful of writes; be conservative and call it 5 requests.
  const regsPerMin = Math.floor((safe / 5) * 60);
  row('≈ registrations per minute', regsPerMin.toLocaleString('en-IN'));
  row('≈ registrations per hour', (regsPerMin * 60).toLocaleString('en-IN'));

  console.log('');
  console.log('  These numbers describe the ONE endpoint you tested. A cached read is');
  console.log('  cheap; a dashboard load or a registration write is not. Test the page');
  console.log('  you actually worry about, and treat a light endpoint as an upper bound.');

  console.log('');
  if (measured.p95 > 1000) bad(`p95 is ${measured.p95.toFixed(0)}ms — already slow under this load.`);
  else if (measured.p95 > 400) warn(`p95 is ${measured.p95.toFixed(0)}ms — acceptable, watch it.`);
  else ok(`p95 is ${measured.p95.toFixed(0)}ms — comfortable.`);

  if (cfg.instances === 1 && cfg.cores > 1) {
    console.log(`\n  Clustering to ${cfg.cores} processes should raise all of the above`);
    console.log(`  roughly ${cfg.cores}x, because ${cfg.cores - 1} core(s) are idle today.`);
  }

  h1('How to raise the ceiling');
  console.log(`
  1. Use every core.  ecosystem.config.js has instances: 1.
     Setting instances: "max" runs one process per core — the single biggest win,
     and it needs no code change.

     CAUTION: this app runs cron jobs in-process (services/automationCron.js).
     With N instances they fire N times. Gate them so only one instance runs
     them, e.g.  if (process.env.NODE_APP_INSTANCE === '0') startCronJobs()

  2. Raise the DB pool if you cluster. maxPoolSize is per process, so N
     processes open N pools. Check your MongoDB plan's connection limit first.

  3. Let nginx serve the static files. It is far better at it than Node, and
     the portal is mostly HTML/JS/images.

  4. Watch, do not guess:  pm2 monit          live CPU and memory per process
                           pm2 logs --err     errors as they happen
                           node scripts/capacity-check.js --load <url>
`);
}

async function main() {
  const cfg = reportMachine();
  let measured = null;
  if (LOAD_URL) measured = await loadTest(LOAD_URL);
  reportPeople(measured, cfg);
}

main().catch((err) => { console.error('Failed:', err.message); process.exitCode = 1; });
