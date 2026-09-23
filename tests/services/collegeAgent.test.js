'use strict';

/**
 * The agent run, the selection, and the review-before-send.
 *
 * runBulk is exercised for real against a stubbed discoverFromSite, because
 * the properties that matter are about control flow — every site visited
 * exactly once, one failure not ending the run, two runs not overlapping —
 * and none of those need a network or a database.
 */

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '../..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const code = (rel) => read(rel)
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

describe('every touched file parses', () => {
  ['config/collegeSeeds.js', 'services/collegeDiscovery.js',
   'services/collegeOutreach.js', 'routes/growth.js'].forEach((f) => {
    test(f, () => {
      execFileSync(process.execPath, ['--check', path.join(root, f)], { stdio: 'pipe' });
    });
  });
});

// ─── the seed roster ─────────────────────────────────────────────────────────

const { SEED_COLLEGES } = require('../../config/collegeSeeds');

describe('the seed roster', () => {
  test('is big enough to plausibly reach a few hundred contacts', () => {
    // Observed yield on the first live run was ~0.4 contacts per college with
    // the strict filter only. The relaxed second pass roughly doubles that, so
    // reaching ~300 needs a roster in the high hundreds, not one of 177.
    expect(SEED_COLLEGES.length).toBeGreaterThan(300);
  });

  test('has no duplicates, which would waste a visit each', () => {
    expect(new Set(SEED_COLLEGES).size).toBe(SEED_COLLEGES.length);
  });

  test('every entry is a bare domain, not a URL or a path', () => {
    // discoverFromSite appends its own paths; a URL here would produce
    // https://x.ac.in/placement/placement and 404 on every college.
    SEED_COLLEGES.forEach((d) => {
      expect(d).toMatch(/^[a-z0-9.-]+\.[a-z]{2,}$/);
      expect(d).not.toMatch(/^https?:|\//);
    });
  });

  test('every entry resolves to an origin', () => {
    const { toOrigin } = require('../../services/collegeDiscovery.js');
    SEED_COLLEGES.forEach((d) => expect(toOrigin(d)).not.toBe(''));
  });
});

// ─── runBulk, for real ───────────────────────────────────────────────────────

const discovery = require('../../services/collegeDiscovery.js');

/*
 * The two calls that would reach the network and the database, replaced.
 *
 * Passed in rather than monkey-patched: runBulk calls the local bindings, not
 * the module exports, so reassigning `discovery.discoverFromSite` does nothing
 * and the real crawler runs — which is exactly what the first version of this
 * file did, and it sat there crawling real colleges for eight seconds.
 */
function stub(perSite) {
  const visited = [];
  return {
    visited,
    deps: {
      discover: async (site) => { visited.push(site); return perSite(site); },
      save: async (rows) => ({ added: rows.length, skipped: 0 })
    },
    restore() {}
  };
}

describe('runBulk', () => {
  const SITES = ['a.ac.in', 'b.ac.in', 'c.ac.in', 'd.ac.in', 'e.ac.in'];

  test('visits every site exactly once', async () => {
    const s = stub(() => [{ email: 'p@x.ac.in', sourceUrl: 'https://x.ac.in/p' }]);
    try {
      const st = await discovery.runBulk(SITES, s.deps);
      expect(s.visited.sort()).toEqual([...SITES].sort());
      expect(st.processed).toBe(5);
      expect(st.added).toBe(5);
      expect(st.running).toBe(false);
    } finally { s.restore(); }
  });

  test('one unreachable college does not end the run', async () => {
    const s = stub((site) => {
      if (site === 'c.ac.in') throw new Error('certificate expired');
      return [{ email: 'p@x.ac.in', sourceUrl: 'https://x.ac.in/p' }];
    });
    try {
      const st = await discovery.runBulk(SITES, s.deps);
      expect(st.processed).toBe(5);
      expect(st.failed).toBe(1);
      expect(st.added).toBe(4);
    } finally { s.restore(); }
  });

  test('a college that publishes nothing is counted, not lost', async () => {
    const s = stub(() => []);
    try {
      const st = await discovery.runBulk(SITES, s.deps);
      expect(st.processed).toBe(5);
      expect(st.added).toBe(0);
      expect(st.skipped).toBe(5);
    } finally { s.restore(); }
  });

  test('duplicate sites are visited once', async () => {
    const s = stub(() => []);
    try {
      await discovery.runBulk(['a.ac.in', 'a.ac.in', 'b.ac.in'], s.deps);
      expect(s.visited.length).toBe(2);
    } finally { s.restore(); }
  });

  test('a second run cannot start while one is in flight', async () => {
    let release;
    const gate = new Promise((r) => { release = r; });
    const s = stub(async () => { await gate; return []; });
    try {
      const first = discovery.runBulk(SITES, s.deps);
      // Same tick — the flag must already be set, or two runs double every visit.
      const refused = await discovery.runBulk(['z.ac.in'], s.deps);
      expect(refused.running).toBe(true);
      expect(s.visited).not.toContain('z.ac.in');
      release();
      await first;
    } finally { s.restore(); }
  });

  test('status reports progress rather than only the end', async () => {
    const s = stub(() => []);
    try {
      await discovery.runBulk(SITES, s.deps);
      const st = discovery.runStatus();
      expect(st.total).toBe(5);
      expect(st.finishedAt).toBeInstanceOf(Date);
      expect(st.running).toBe(false);
    } finally { s.restore(); }
  });

  test('concurrency is bounded — the run is not 371 sockets at once', () => {
    expect(discovery.CONCURRENCY).toBeGreaterThanOrEqual(1);
    expect(discovery.CONCURRENCY).toBeLessThanOrEqual(24);
  });

  test('a dead host is abandoned instead of timing out on every path', () => {
    // The whole reason a run took an hour: eight paths, each waiting the full
    // timeout, on a college whose server was simply down.
    const src = read('services/collegeDiscovery.js');
    expect(src).toContain('DEAD_HOST_STREAK');
    const loop = src.slice(src.indexOf('async function discoverFromSite'));
    expect(loop).toMatch(/if \(!reachable\)/);
    expect(loop.slice(0, 1200)).toContain('break');
  });

  test('a 404 is not treated as a dead host', () => {
    // Otherwise two wrong paths in a row would abandon a college that is up.
    const src = read('services/collegeDiscovery.js');
    const fn = src.slice(src.indexOf('async function fetchPage'));
    expect(fn.slice(0, 700)).toMatch(/if \(!res\.ok\) return \{ reachable: true/);
  });

  test('timeouts are short enough that a run finishes', () => {
    const src = read('services/collegeDiscovery.js');
    const m = src.match(/COLLEGE_FETCH_TIMEOUT_MS, 10\) \|\| (\d+)/);
    expect(m).toBeTruthy();
    expect(Number(m[1])).toBeLessThanOrEqual(8000);
  });
});

// ─── selection and review ────────────────────────────────────────────────────

describe('a ticked selection cannot widen who gets mailed', () => {
  const src = code('services/collegeOutreach.js');

  test('ids narrow the query, they do not replace it', () => {
    const fn = src.slice(src.indexOf('async function run('));
    expect(fn).toMatch(/const filter = \{ status: 'new', optOut: \{ \$ne: true \} \}/);
    expect(fn).toMatch(/filter\._id = \{ \$in: ids \}/);
  });

  test('nothing can remove the opt-out guard after the filter is built', () => {
    // Checking only that the filter is BUILT correctly is not enough — an
    // earlier version of this test passed while `delete filter.optOut` sat one
    // line below it, which is precisely "select all mails people who left".
    const fn = src.slice(src.indexOf('async function run('));
    expect(fn).not.toMatch(/delete\s+filter\./);
    expect(fn).not.toMatch(/filter\.optOut\s*=/);
    expect(fn).not.toMatch(/filter\.status\s*=/);
    // Assigned once, never rebound.
    expect((fn.match(/\bfilter\s*=/g) || []).length).toBe(1);
  });

  test('the quota is still checked per message inside the loop', () => {
    const loop = src.slice(src.indexOf('for (let i = 0'));
    expect(loop).toContain('quota.canSend(1)');
  });

  test('the route counts through the same filter it sends through', () => {
    const r = code('routes/growth.js');
    const route = r.slice(r.indexOf("api.post('/colleges/send'"));
    expect(route.slice(0, 1200)).toMatch(/pendingFilter = \{ status: 'new', optOut: \{ \$ne: true \} \}/);
  });
});

describe('the reviewed email is the one that gets sent', () => {
  const r = code('routes/growth.js');
  const route = r.slice(r.indexOf("api.get('/colleges/template'"), r.indexOf("api.get('/colleges',"));

  test('it renders through the sender, so it cannot drift', () => {
    expect(route).toContain('collegeOutreach.buildHtml');
  });

  test('it hands buildHtml a placeholder id, never a real college', () => {
    // buildHtml signs the unsubscribe link with the id it is given; a real one
    // would be a working "remove me" link inside the review pane.
    expect(route).toMatch(/_id:\s*'preview'/);
  });

  test('it sends nothing and writes nothing', () => {
    expect(route).not.toMatch(/sendMail|\.create\(|\.updateOne\(|outreach\.run/);
  });
});

describe('the dashboard flow', () => {
  const html = read('public/growth-os.html');

  test.each([['agentRun'], ['agentBar'], ['colAll'], ['colTemplate'], ['colSend'], ['colSelCount']])
    ('%s exists', (id) => expect(html).toContain('id="' + id + '"'));

  test('Send is disabled until something is ticked', () => {
    expect(html).toMatch(/id="colSend"[^>]*disabled/);
  });

  test('pressing Send shows the template before it confirms', () => {
    const at = html.indexOf("$('colSend').addEventListener");
    const fn = html.slice(at, at + 700);
    expect(fn).toContain('showTemplate');
    expect(fn).toContain("call('/colleges/template')");
    // The send itself must not fire straight from the button.
    expect(fn).not.toContain("call('/colleges/send'");
  });

  test('the send carries the ticked ids', () => {
    expect(html).toMatch(/ids: Array\.from\(state\.colPicked\)/);
  });

  test('only a waiting college gets a tick box', () => {
    const at = html.indexOf('state.colleges.forEach');
    expect(html.slice(at, at + 500)).toMatch(/c\.status === 'new' && !c\.optOut/);
  });

  test('the template html is assigned to srcdoc, not concatenated into markup', () => {
    expect(html).toMatch(/querySelector\('iframe'\)\.srcdoc = r\.html/);
  });
});
