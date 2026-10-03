'use strict';

/**
 * Every run must find colleges the last run had never heard of.
 *
 * The agent was handed the same hard-coded list of 371 seeds on every press of
 * Run. The first run collected everything those sites publish; every run after
 * it re-read the same pages to find nothing — "Visiting 238 of 371 — found 0".
 * The work was being repeated rather than continued.
 *
 * Two changes make a run pick up where the last one stopped: the list of
 * places to visit is a QUEUE in the database rather than an array in a config
 * file, and the crawl GROWS that queue by reading every page a second time,
 * for links to other colleges.
 */

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '../..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const code = (rel) => read(rel)
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

const discovery = require('../../services/collegeDiscovery');
const { harvestHosts, registrableHost } = discovery;

describe('a college site is one site, not one per department', () => {
  test.each([
    ['cse.nitk.ac.in',      'nitk.ac.in'],
    ['www.iitb.ac.in',      'iitb.ac.in'],
    ['alumni.anna.edu.in',  'anna.edu.in'],
    ['nitk.ac.in',          'nitk.ac.in'],
    ['a.b.c.vtu.ac.in',     'vtu.ac.in'],
  ])('%s is the site %s', (host, want) => {
    expect(registrableHost(host)).toBe(want);
  });

  test('case and a trailing www do not make a second site', () => {
    expect(registrableHost('WWW.NITK.AC.IN')).toBe('nitk.ac.in');
  });
});

describe('every page is read twice — for addresses, and for other colleges', () => {
  const page = [
    '<a href="https://www.vtu.ac.in/affiliated">VTU</a>',
    '<a href="https://cse.nitk.ac.in/x">our CSE dept</a>',
    '<a href="https://nitk.ac.in/y">us again</a>',
    '<a href="https://anna.edu.in/p">Anna University</a>',
    '<a href="https://facebook.com/x">social</a>',
    '<a href="https://somecompany.com">a recruiter</a>'
  ].join(' ');

  const found = harvestHosts(page, 'https://nitk.ac.in/placement');

  test('it finds the other colleges this page links to', () => {
    expect(found).toContain('vtu.ac.in');
    expect(found).toContain('anna.edu.in');
  });

  test('it never queues the college it is already on', () => {
    // Including that college's own subdomains, which are the same place.
    expect(found).not.toContain('nitk.ac.in');
  });

  test('it ignores everything that is not an Indian academic domain', () => {
    expect(found).not.toContain('facebook.com');
    expect(found).not.toContain('somecompany.com');
  });

  /*
   * The honesty rule, one level up from addresses. `.ac.in` and `.edu.in` are
   * restricted suffixes — you cannot register one without being a recognised
   * institution — so a link to one is a real college. Inventing a DOMAIN would
   * be the same sin as inventing an address.
   */
  test('only restricted academic suffixes are collected', () => {
    // Behaviour, not the regex text: a .com is not a recognised institution.
    expect(harvestHosts('<a href="https://college.com">x</a>', 'https://a.ac.in/')).toEqual([]);
    expect(harvestHosts('<a href="https://college.org">x</a>', 'https://a.ac.in/')).toEqual([]);
    expect(harvestHosts('<a href="https://x.ac.in/p">x</a>', 'https://a.ac.in/')).toEqual(['x.ac.in']);
    expect(harvestHosts('<a href="https://y.edu.in/p">x</a>', 'https://a.ac.in/')).toEqual(['y.edu.in']);
  });

  test('a bare suffix is not a college', () => {
    expect(harvestHosts('<a href="https://ac.in/">x</a>', 'https://a.ac.in/')).toEqual([]);
  });

  /*
   * Caught by mutation testing: every assertion above passed while the crawl
   * had stopped calling the harvester altogether. Checking that a function
   * works is not the same as checking that anything uses it — the queue could
   * never grow and nothing failed.
   */
  test('the crawl actually harvests from every page it reads', () => {
    const fn = code('services/collegeDiscovery.js');
    const loop = fn.slice(fn.indexOf('async function discoverFromSite'),
                          fn.indexOf('async function saveContacts'));
    expect(loop).toMatch(/rememberSites\(harvestHosts\(html, url\), url\)/);
  });

  /*
   * Also caught by mutation: a three-label non-academic host. The two-label
   * ones every other test used (facebook.com) were being rejected by the
   * "a bare suffix is not a college" guard, so a regex that matched ANY domain
   * still passed. This one gets through that guard and must still be refused.
   */
  test('a deep non-academic host is refused, not just a short one', () => {
    expect(harvestHosts('<a href="https://blog.sub.example.com/x">x</a>',
                        'https://a.ac.in/')).toEqual([]);
    expect(harvestHosts('<a href="https://news.bbc.co.uk/x">x</a>',
                        'https://a.ac.in/')).toEqual([]);
  });

  test('nothing in, nothing out', () => {
    expect(harvestHosts('', 'https://a.ac.in/')).toEqual([]);
    expect(harvestHosts(null, null)).toEqual([]);
  });
});

describe('a run takes the NEXT unvisited colleges', () => {
  const src = code('services/collegeDiscovery.js');

  test('the queue is asked for what has not been visited, oldest first', () => {
    const fn = src.slice(src.indexOf('async function nextBatch'));
    expect(fn).toMatch(/find\(\{ status: 'new' \}\)/);
    expect(fn).toMatch(/sort\(\{ createdAt: 1 \}\)/);
  });

  test('runBulk with no list reads the queue instead of a config file', () => {
    const fn = src.slice(src.indexOf('async function runBulk'));
    expect(fn).toMatch(/if \(!list\.length\)/);
    expect(fn).toMatch(/deps\.nextBatch \|\| nextBatch/);
  });

  test('the route no longer hands it the same 371 seeds every time', () => {
    const route = code('routes/growth.js');
    const fn = route.slice(route.indexOf("api.post('/colleges/agent/run'"));
    expect(fn.slice(0, 1600)).toMatch(/runBulk\(\)/);
    expect(fn.slice(0, 1600)).not.toMatch(/runBulk\(SEED_COLLEGES\)/);
  });

  test('the seeds are still the starting point, loaded once', () => {
    const fn = src.slice(src.indexOf('async function nextBatch'));
    expect(fn).toMatch(/if \(!waiting\)/);
    expect(fn).toMatch(/SEED_COLLEGES/);
  });

  /*
   * The bug in one assertion. A site that stays `new` after being tried is a
   * site the agent visits again on every single run, forever — which is
   * exactly what it was doing.
   */
  test('a visited college is marked, whatever the visit produced', () => {
    const worker = src.slice(src.indexOf('async function worker'));
    expect(worker).toMatch(/markVisited\)\(site, got, reached\)/);
    const mark = src.slice(src.indexOf('async function markVisited'));
    expect(mark).toMatch(/status: reached === false \? 'dead' : 'visited'/);
  });

  test('a host already in the queue is never dragged back to new', () => {
    // Another college linking to one we have visited must not re-queue it.
    const start = src.indexOf('async function rememberSites');
    const body = src.slice(start, src.indexOf('\n}', start));
    expect(body).toMatch(/\$setOnInsert/);
    // A plain $set would reset status on every re-link — the re-visiting bug.
    expect(body).not.toMatch(/\$set\b/);
  });

  test('an explicit list still wins, which is how this file is tested', () => {
    const fn = src.slice(src.indexOf('async function runBulk'));
    expect(fn).toMatch(/let list = \[\.\.\.new Set\(\(sites \|\| \[\]\)/);
  });
});

describe('the run is sized for what the outreach needs', () => {
  test('a batch is big enough to yield the contacts asked for', () => {
    // Over a hundred reachable officials per run was the requirement; at this
    // hit rate that needs a few hundred unvisited colleges, not a few dozen.
    expect(discovery.BATCH).toBeGreaterThanOrEqual(200);
  });

  test('and tunable without a deploy', () => {
    expect(code('services/collegeDiscovery.js')).toMatch(/COLLEGE_AGENT_BATCH/);
  });
});

describe('the dashboard explains an empty run instead of just saying 0', () => {
  const html = read('public/growth-os.html');

  test('it shows how many colleges are still waiting', () => {
    expect(html).toMatch(/id="agentQueue"/);
    expect(html).toMatch(/call\('\/colleges\/agent\/queue'\)/);
    expect(html).toMatch(/colleges waiting/);
  });

  test('the queue count is refreshed when a run ends', () => {
    const fn = html.slice(html.indexOf('function renderAgent'));
    expect(fn.slice(0, 900)).toMatch(/loadQueue\(\)/);
  });

  test('running out of colleges says so, rather than finding nothing', () => {
    const route = code('routes/growth.js');
    const fn = route.slice(route.indexOf("api.post('/colleges/agent/run'"));
    expect(fn.slice(0, 1600)).toMatch(/Every college the agent knows has been visited/);
  });
});

describe('the queue model', () => {
  const model = read('models/CollegeSite.js');

  test('a host is stored once', () => {
    expect(model).toMatch(/host:.*unique: true/);
  });

  test('it records where it came from, so a bad host can be traced', () => {
    expect(model).toMatch(/discoveredFrom/);
    expect(model).toMatch(/via:/);
  });

  test('the three states the crawl needs, and no more', () => {
    expect(model).toMatch(/enum: \['new', 'visited', 'dead'\]/);
  });

  test('the queue query is indexed', () => {
    expect(model).toMatch(/index\(\{ status: 1, createdAt: 1 \}\)/);
  });
});
