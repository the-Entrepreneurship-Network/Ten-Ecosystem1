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

describe('the agent writes to the authorities, never to students', () => {
  const { WRONG_DESK, PLACEMENT_DESK, AUTHORITY_DESK, isMailableDesk, rankOf } = discovery;

  /*
   * This block used to assert the OPPOSITE — that rector@, registrar@ and vc@
   * were refused — because the first brief was "the placement desk, not the
   * administration". The brief is now the authorities: the people who can
   * actually approve a partnership. The tests are inverted deliberately, not
   * loosened, and what stays refused is listed just as explicitly.
   */
  test.each([
    ['pa2rector'], ['rector'], ['registrar'], ['vc'], ['vicechancellor'],
    ['chancellor'], ['principal'], ['director'], ['dean'], ['hod'], ['provost']
  ])('%s@ is an authority worth writing to', (local) => {
    expect(isMailableDesk(local + '@x.ac.in')).toBe(true);
  });

  test.each([
    ['coe'], ['controller'], ['library'], ['librarian'], ['accounts'], ['finance'],
    ['exam'], ['hostel'], ['warden'], ['transport'], ['admissions'], ['scholarship'],
    ['tender'], ['antiragging']
  ])('%s@ is still refused — that desk deletes an internship offer', (local) => {
    expect(WRONG_DESK.test(local)).toBe(true);
    expect(isMailableDesk(local + '@x.ac.in')).toBe(false);
  });

  /* The explicit requirement: authorities yes, students never. */
  test.each([
    ['21cse045'], ['b190234'], ['2020ucs1234'], ['19bce1234'],
    ['student'], ['students'], ['alumni2021']
  ])('%s@ is a student address and is refused', (local) => {
    expect(isMailableDesk(local + '@x.ac.in')).toBe(false);
  });

  test.each([
    ['tpo@student.x.ac.in'], ['info@students.x.ac.in'], ['a@stu.x.ac.in'],
    ['b@alumni.x.ac.in']
  ])('%s is on a student subdomain and is refused', (addr) => {
    expect(isMailableDesk(addr)).toBe(false);
  });

  /* The student rules are shaped like roll numbers, and a desk name must not
     trip them. These four are the ones that would have, if written loosely. */
  test.each([['tpo2'], ['principal2024'], ['hod.cse'], ['placement1']])
    ('%s@ is a desk, not a roll number', (local) => {
      expect(isMailableDesk(local + '@x.ac.in')).toBe(true);
    });

  test.each([
    ['tpo'], ['placement'], ['placements'], ['tnp'], ['cdc'],
    ['training'], ['careers'], ['internship'], ['corporate'], ['outreach']
  ])('%s@ is still the placement desk, ranked first', (local) => {
    expect(PLACEMENT_DESK.test(local)).toBe(true);
    expect(rankOf({ email: local + '@x.ac.in' })).toBe(1);
  });

  test('an authority ranks below placement but above the front office', () => {
    expect(rankOf({ email: 'principal@x.ac.in' })).toBe(2);
    expect(AUTHORITY_DESK.test('principal')).toBe(true);
    expect(rankOf({ email: 'info@x.ac.in' })).toBe(3);
    expect(rankOf({ email: 'rpsharma@x.ac.in' })).toBe(4);
  });

  test('a stated role outranks the address — a named TPO is the placement desk', () => {
    // The strict pass reads "Training and Placement Officer" out of the page,
    // so rpsharma@ is tier 1 even though nothing in the address says so.
    expect(rankOf({ email: 'rpsharma@x.ac.in', role: 'Training and Placement Officer' })).toBe(1);
    expect(rankOf({ email: 'rpsharma@x.ac.in', contactRole: 'Registrar' })).toBe(2);
  });

  /* Run for real. An earlier version of these read the source instead, and
     passed while the wrong-desk check had been weakened to "has an email" —
     the test was checking the shape of the code, not its behaviour. */
  const sel = (...addrs) =>
    discovery.selectContacts(addrs.map((email) => ({ email }))).map((r) => r.email);

  test('placement first, then the authority — both kept', () => {
    expect(sel('pa2rector@x.ac.in', 'tpo@x.ac.in', 'library@x.ac.in'))
      .toEqual(['tpo@x.ac.in', 'pa2rector@x.ac.in']);
  });

  test('the wrong desk is dropped even when nothing better is there', () => {
    expect(sel('library@x.ac.in', 'accounts@x.ac.in')).toEqual([]);
  });

  test('a general office survives when no better address was published', () => {
    // Applying the filter after the fallback decision made this case yield
    // nothing: accounts@ looked like a hit, skipped the fallback, then lost it.
    expect(sel('info@x.ac.in', 'accounts@x.ac.in')).toEqual(['info@x.ac.in']);
    expect(sel('principal@x.ac.in')).toEqual(['principal@x.ac.in']);
  });

  /*
   * The cap is what keeps this outreach rather than spam. A contact page
   * listing fifteen HODs must not become fifteen mails to one institution
   * from the domain that also carries students' certificates.
   */
  test('one college yields at most MAX_PER_COLLEGE addresses', () => {
    const many = sel('tpo@x.ac.in', 'principal@x.ac.in', 'dean@x.ac.in',
                     'hod@x.ac.in', 'registrar@x.ac.in', 'info@x.ac.in');
    expect(many.length).toBe(discovery.MAX_PER_COLLEGE);
    expect(discovery.MAX_PER_COLLEGE).toBeLessThanOrEqual(5);
    expect(many[0]).toBe('tpo@x.ac.in');   // best first, always
  });

  test('the cap is overridable for a caller that knows better', () => {
    expect(discovery.selectContacts(
      [{ email: 'tpo@x.ac.in' }, { email: 'principal@x.ac.in' }, { email: 'dean@x.ac.in' }], 3
    ).length).toBe(3);
  });

  test('the fallback pass is selected through the same rule', () => {
    const fn = read('services/collegeDiscovery.js');
    const loop = fn.slice(fn.indexOf('async function discoverFromSite'));
    expect(loop).toMatch(/selectContacts\(collegeContactsFrom\(/);
  });

  test('it survives nothing at all', () => {
    expect(discovery.selectContacts([])).toEqual([]);
    expect(discovery.selectContacts(null)).toEqual([]);
    expect(discovery.selectContacts([{}, { email: '' }])).toEqual([]);
    expect(isMailableDesk('')).toBe(false);
    expect(isMailableDesk('no-at-sign')).toBe(false);
  });

  test('the shared recruiter extractor is left alone', () => {
    // WRONG_DESK belongs to college discovery. Putting it in
    // recruiterContacts.js would change what the live job agent returns.
    expect(read('services/v2/recruiterContacts.js')).not.toContain('WRONG_DESK');
  });
});

describe('an address that cannot receive mail is not a contact', () => {
  test('a real domain resolves, an invented one does not', async () => {
    expect(await discovery.hasMx('gmail.com')).toBe(true);
    expect(await discovery.hasMx('no-such-domain-for-ten-tests-xyz123.ac.in')).toBe(false);
  });

  test('nonsense input is false, never a throw', async () => {
    expect(await discovery.hasMx('')).toBe(false);
    expect(await discovery.hasMx(null)).toBe(false);
    expect(await discovery.hasMx('localhost')).toBe(false);   // no dot, not a domain
  });

  test('the answer is remembered, so one college is one lookup', async () => {
    const first = await discovery.hasMx('gmail.com');
    const second = await discovery.hasMx('GMAIL.COM');       // same domain, any case
    expect(first).toBe(true);
    expect(second).toBe(true);
  });

  const src = code('services/collegeDiscovery.js');

  test('a resolver blip is not cached as a dead domain', () => {
    // ENOTFOUND is permanent and worth remembering. A timeout or SERVFAIL is
    // the resolver having a bad moment, and caching it would condemn a real
    // college for the lifetime of the process.
    const fn = src.slice(src.indexOf('async function hasMx'));
    expect(fn).toMatch(/code === 'ENOTFOUND'/);
    expect(fn).toMatch(/if \(code !== 'ENODATA'\) return false;/);
  });

  test('a domain with an A record but no MX still counts — RFC 5321', () => {
    expect(src.slice(src.indexOf('async function hasMx'))).toMatch(/resolve4/);
  });

  test('it uses the resolver Node ships with, not a paid API', () => {
    expect(src).toMatch(/require\('dns'\)\.promises/);
    const pkg = JSON.parse(read('package.json'));
    const deps = Object.keys(pkg.dependencies || {});
    expect(deps.filter((d) => /email.*verif|verif.*email|mailboxlayer|zerobounce/i.test(d)))
      .toEqual([]);
  });

  test('discovery refuses to store an unroutable address', () => {
    const fn = src.slice(src.indexOf('async function saveContacts'));
    expect(fn).toMatch(/hasMx\(String\(r\.email\)\.split\('@'\)\[1\]\)/);
    expect(fn).toMatch(/mxOk: true/);
  });

  test('the sender and the preview share ONE deliverability rule', () => {
    // If the review pane counted its own way it would promise a number the
    // sender quietly fails to match, and the review step becomes theatre.
    const out = code('services/collegeOutreach.js');
    expect(out).toMatch(/async function partitionByDeliverability/);
    expect(out).toMatch(/module\.exports[\s\S]*partitionByDeliverability/);
    const run = out.slice(out.indexOf('async function run('));
    expect(run).toMatch(/partitionByDeliverability\(found\)/);
    expect(code('routes/growth.js')).toMatch(/collegeOutreach\.partitionByDeliverability/);
  });

  test('a verdict is written back, so it costs one lookup ever', () => {
    const out = code('services/collegeOutreach.js');
    expect(out).toMatch(/\$set: \{ mxOk: ok, mxCheckedAt: new Date\(\) \}/);
    expect(read('models/CollegeContact.js')).toMatch(/mxOk:\s*\{ type: Boolean \}/);
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
  const route = r.slice(r.indexOf("api.post('/colleges/preview'"),
                        r.indexOf("api.get('/colleges',"));

  test('it renders through the sender, so it cannot drift', () => {
    expect(route).toContain('collegeOutreach.buildHtml');
  });

  test('it hands buildHtml a placeholder id, never a real college', () => {
    // buildHtml signs the unsubscribe link with the id it is given; a real one
    // would be a working "remove me" link inside the review pane.
    expect(route).toMatch(/_id:\s*'preview'/);
  });

  test('it sends nothing and writes nothing', () => {
    expect(route).not.toMatch(/sendMail|\.create\(|outreach\.run/);
  });

  /*
   * The bug this replaced: the old route did findOne({ status: 'new' }) and
   * showed whatever the database handed back, with no reference to what had
   * been ticked. So the review step displayed a letter addressed to a college
   * that was not in the send, and approving it reviewed nothing.
   */
  test('it previews the SELECTED colleges, not whatever the database offers', () => {
    expect(route).toMatch(/filter\._id = \{ \$in: ids \}/);
    expect(route).not.toMatch(/findOne\(/);
  });

  test('a ticked selection still cannot widen who is previewed', () => {
    // Same filter the sender uses: ticking an opted-out college must not
    // preview a mail the sender would refuse to send.
    expect(route).toMatch(/const filter = \{ status: 'new', optOut: \{ \$ne: true \} \}/);
  });

  test('it pages through the selection rather than showing one row', () => {
    expect(route).toMatch(/index/);
    expect(route).toMatch(/total: sendable\.length/);
  });

  test('it reports who will be skipped, counted the sender\'s way', () => {
    expect(route).toMatch(/collegeOutreach\.partitionByDeliverability/);
    expect(route).toMatch(/noMx:/);
    expect(route).toMatch(/unavailable:/);
  });

  test('it names the actual recipient, so the reviewer can check it', () => {
    expect(route).toMatch(/recipient: \{/);
    expect(route).toMatch(/email: recipient\.email/);
    expect(route).toMatch(/contactRole: recipient\.contactRole/);
  });
});

describe('the dashboard flow', () => {
  const html = read('public/growth-os.html');

  test.each([['agentRun'], ['agentBar'], ['colAll'], ['colTemplate'], ['colSend'], ['colSelCount']])
    ('%s exists', (id) => expect(html).toContain('id="' + id + '"'));

  test('Send is disabled until something is ticked', () => {
    expect(html).toMatch(/id="colSend"[^>]*disabled/);
  });

  test('pressing Send shows the real recipient before it confirms', () => {
    const at = html.indexOf("$('colSend').addEventListener");
    const fn = html.slice(at, at + 700);
    expect(fn).toContain('openReview(0, true)');
    // The send itself must not fire straight from the button.
    expect(fn).not.toContain("call('/colleges/send'");
  });

  test('the review asks for the ticked ids, so it shows who is being mailed', () => {
    const at = html.indexOf('async function openReview');
    const fn = html.slice(at, at + 500);
    expect(fn).toContain("call('/colleges/preview'");
    expect(fn).toMatch(/ids: Array\.from\(state\.colPicked\)/);
    expect(fn).toContain('index: review.index');
  });

  test('scraped college and officer names are escaped before becoming HTML', () => {
    // These strings come off somebody else's web page.
    const at = html.indexOf('function showTemplate');
    const fn = html.slice(at, at + 2600);
    expect(fn).toMatch(/esc\(rcpt\.college/);
    expect(fn).toMatch(/esc\(rcpt\.contactName\)/);
    expect(fn).toMatch(/esc\(rcpt\.email\)/);
    expect(html).toMatch(/var esc = function/);
  });

  test('nothing to send is not something to confirm', () => {
    const at = html.indexOf('function showTemplate');
    const fn = html.slice(at, html.indexOf('async function startCollegeSend'));
    expect(at).toBeGreaterThan(-1);
    expect(fn.length).toBeGreaterThan(0);
    expect(fn).toMatch(/review\.withSend && total \?/);
    expect(fn).toMatch(/\(review\.withSend && total\)/);
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
