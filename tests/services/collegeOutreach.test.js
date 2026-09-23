'use strict';

/**
 * College outreach, checked two ways.
 *
 * The parsing is exercised for real — it is pure text work and needs neither a
 * database nor a network. The wiring is checked against source, because the
 * properties that matter here are the ones that would otherwise fail silently:
 * a mail type that does not count against the quota, an unsubscribe that
 * writes to the wrong collection, an import that revives an opted-out address.
 */

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '../..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
/* Comments describe intent; they must never satisfy an assertion about code. */
const code = (rel) => read(rel)
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

const FILES = [
  'models/CollegeContact.js', 'services/collegeDiscovery.js',
  'services/collegeOutreach.js', 'scripts/import-colleges.js'
];

describe('every file parses', () => {
  FILES.forEach((f) => {
    test(f, () => {
      execFileSync(process.execPath, ['--check', path.join(root, f)], { stdio: 'pipe' });
    });
  });
});

// ─── the parsing, run for real ───────────────────────────────────────────────

const discovery = require('../../services/collegeDiscovery');
const { contactsFromPosting } = require('../../services/v2/recruiterContacts');

describe('htmlToText', () => {
  test('drops script and style bodies entirely', () => {
    const html = '<style>.a{color:red}</style><script>var x="bot@evil.com";</script><p>Hello</p>';
    const text = discovery.htmlToText(html);
    expect(text).toContain('Hello');
    expect(text).not.toContain('bot@evil.com');
    expect(text).not.toContain('color:red');
  });

  test('tags become whitespace so neighbouring words do not fuse', () => {
    // Without this, "contact" and "placement@x.edu" merge into one token and
    // the cue check that keeps extraction honest can never match.
    expect(discovery.htmlToText('<b>Contact</b><span>placement@x.edu</span>'))
      .toMatch(/Contact\s+placement@x\.edu/);
  });

  test('decodes the entities a contact block actually contains', () => {
    expect(discovery.htmlToText('<p>T&amp;P Cell&nbsp;&#8212; email us</p>')).toContain('T&P Cell');
  });
});

describe('toOrigin', () => {
  test.each([
    ['example.edu.in', 'http://example.edu.in'],
    ['https://www.example.edu.in/placements', 'https://www.example.edu.in'],
    ['  http://a.ac.in  ', 'http://a.ac.in']
  ])('%s → %s', (input, expected) => {
    expect(discovery.toOrigin(input)).toBe(expected);
  });

  test.each(['', '   ', 'not a url', 'localhost'])('rejects %p', (bad) => {
    expect(discovery.toOrigin(bad)).toBe('');
  });
});

describe('titleOf', () => {
  test('reads the page title', () => {
    expect(discovery.titleOf('<html><head><title>  Training &  Placement </title></head>'))
      .toBe('Training & Placement');
  });
  test('returns empty when there is none', () => {
    expect(discovery.titleOf('<html><body>hi</body></html>')).toBe('');
  });
});

describe('extraction on a real placement page shape', () => {
  const page = `<html><head><title>Training and Placement — Kalinga Institute</title></head>
    <body><h1>Training &amp; Placement Cell</h1>
    <p>Companies wishing to recruit our students may contact Dr Anita Rao,
       Placement Officer, at placement@kalinga.ac.in or +91 98450 12345.</p>
    <footer><a href="/privacy">privacy</a> webmaster@kalinga.ac.in</footer>
    </body></html>`;

  const rows = () => contactsFromPosting({
    description: discovery.htmlToText(page),
    title: discovery.titleOf(page),
    url: 'https://kalinga.ac.in/placement',
    company: 'Kalinga Institute',
    source: 'college-page'
  });

  test('finds the published placement address', () => {
    expect(rows().map((r) => r.email)).toContain('placement@kalinga.ac.in');
  });

  test('drops the webmaster address in the footer', () => {
    // Machinery, not a human, and no sentence there invites contact.
    expect(rows().map((r) => r.email)).not.toContain('webmaster@kalinga.ac.in');
  });

  test('carries the page it came from as evidence', () => {
    expect(rows()[0].sourceUrl).toBe('https://kalinga.ac.in/placement');
  });

  test('picks up the named officer beside the address', () => {
    // "Dr Anita", not "Anita Rao": the shared nameNear() captures at most two
    // capitalised words after the cue, and the honorific eats one of them.
    // Left as it is on purpose — this regex is also the job agent's, it reads
    // fine as a greeting, and rewriting it to chase a surname would put a live
    // recruiter path at risk for a cosmetic gain.
    expect(rows()[0].name).toBe('Dr Anita');
  });

  test('the phone published beside it rides along', () => {
    expect(rows()[0].phone).toMatch(/98450/);
  });

  test('a placeholder domain is rejected, so a template page yields nothing', () => {
    // The shared extractor filters example./test./yourdomain. A half-finished
    // college site full of demo text must not become a mailing list.
    const demo = `<p>For placements, contact us at placement@example.edu.in</p>`;
    expect(contactsFromPosting({ description: discovery.htmlToText(demo), url: 'https://x.ac.in/p' }))
      .toHaveLength(0);
  });
});

describe('PLACEMENT_HINT ranks the right mailbox first', () => {
  test.each(['placement', 'tpo', 'training', 'careers', 'internship', 'corporate.relations'])
    ('%s@ is recognised as the placement office', (local) => {
      expect(discovery.PLACEMENT_HINT.test(local)).toBe(true);
    });
  test.each(['principal', 'library', 'admissions'])('%s@ is not', (local) => {
    expect(discovery.PLACEMENT_HINT.test(local)).toBe(false);
  });
});

describe('saveContacts refuses rows it cannot justify', () => {
  test('a row with no source page is skipped without a write', async () => {
    // The guard runs before any database call, so this is safe with no mongo.
    const res = await discovery.saveContacts([
      { email: 'a@b.edu' },                       // no sourceUrl
      { sourceUrl: 'https://b.edu/contact' },     // no email
      null
    ]);
    expect(res).toEqual({ added: 0, skipped: 3 });
  });
});

// ─── the wiring, checked against source ──────────────────────────────────────

describe('college mail spends the same allowance as everything else', () => {
  test("'college-outreach' is in the quota's marketing types", () => {
    const src = code('config/growthQuota.js');
    const block = src.slice(src.indexOf('MARKETING_TYPES'), src.indexOf('MARKETING_TYPES') + 300);
    expect(block).toContain("'college-outreach'");
  });

  test('the sender writes that exact mailType, or nothing is ever counted', () => {
    expect(code('services/collegeOutreach.js')).toMatch(/mailType:\s*'college-outreach'/);
  });

  test('quota is re-checked inside the loop, not once before it', () => {
    const src = code('services/collegeOutreach.js');
    const loop = src.slice(src.indexOf('for (let i = 0'));
    expect(loop).toContain('quota.canSend(1)');
  });

  test('a refusal stops the run instead of sending anyway', () => {
    const src = code('services/collegeOutreach.js');
    const after = src.slice(src.indexOf('if (!allowed)'), src.indexOf('if (!allowed)') + 200);
    expect(after).toContain('break');
  });
});

describe('opting out actually removes the address', () => {
  const src = code('routes/growth.js');

  test('the college route verifies its own signature kind', () => {
    expect(src).toMatch(/tracking\.verify\(sig,\s*'cu',\s*id\)/);
  });

  test('it writes to CollegeContact, never to Student', () => {
    const route = src.slice(src.indexOf("trackingRouter.get('/cu/"));
    expect(route).toContain('CollegeContact.updateMany');
    expect(route).not.toContain('Student.updateMany');
  });

  test('every row holding that address is opted out, not just the one linked', () => {
    const route = src.slice(src.indexOf("trackingRouter.get('/cu/"));
    expect(route).toMatch(/updateMany\(\{\s*email:/);
  });

  test('the sender only ever picks up rows that have not opted out', () => {
    expect(code('services/collegeOutreach.js')).toMatch(/optOut:\s*\{\s*\$ne:\s*true\s*\}/);
  });
});

describe('re-running discovery or an import cannot undo a decision', () => {
  test('saveContacts inserts only, never overwrites', () => {
    const src = code('services/collegeDiscovery.js');
    expect(src).toContain('$setOnInsert');
    expect(src).not.toMatch(/\$set:/);
  });

  test('the bulk import does the same', () => {
    expect(code('scripts/import-colleges.js')).toContain('$setOnInsert');
  });

  test('the import writes nothing without --apply', () => {
    const src = code('scripts/import-colleges.js');
    expect(src).toContain("APPLY = args.includes('--apply')");
    expect(src).toMatch(/if\s*\(!APPLY\)/);
  });

  test('a missing file is explained, not dumped as a stack trace', () => {
    // The first person to run the documented example did not have the file the
    // example named, and got ten frames of ENOENT out of xlsx.js — which reads
    // as "the script is broken" rather than "that file is not here".
    const src = code('scripts/import-colleges.js');
    const check = src.indexOf('if (!fs.existsSync(file))');
    expect(check).toBeGreaterThan(-1);
    // The guard must run BEFORE xlsx opens anything.
    expect(check).toBeLessThan(src.indexOf('xlsx.readFile'));
    const body = src.slice(check, check + 1400);
    expect(body).toContain('No such file');
    expect(body).toContain('process.cwd()');   // says where it looked
    expect(body).toContain('readdirSync');     // lists what IS there
    expect(body).toContain('scp ');            // says how to get it up
  });

  test('the import never invents an address from a domain', () => {
    const src = code('scripts/import-colleges.js');
    expect(src).not.toMatch(/['"`](principal|info|hod|tpo)@['"`]\s*\+/);
  });
});

describe('the dashboard endpoints are behind the login', () => {
  const src = code('routes/growth.js');
  test.each([
    ["api.get('/colleges'", 'list'],
    ["api.post('/colleges/discover'", 'discover'],
    ["api.post('/colleges/send'", 'send']
  ])('%s requires a session', (needle) => {
    const at = src.indexOf(needle);
    expect(at).toBeGreaterThan(-1);
    expect(src.slice(at, at + 120)).toContain('requireGrowthAPI');
  });

  test('discovery is rate limited, since it reaches somebody else\'s server', () => {
    const at = src.indexOf("api.post('/colleges/discover'");
    expect(src.slice(at, at + 120)).toContain('discoverLimiter');
  });
});

describe('discovery identifies itself and bounds what it fetches', () => {
  const src = code('services/collegeDiscovery.js');
  test('sends a User-Agent naming TEN and a contact URL', () => {
    expect(src).toMatch(/'User-Agent':\s*'TEN-CollegeOutreach[^']*entrepreneurshipnetwork\.net/);
  });
  test('every fetch has a timeout', () => {
    expect(src).toContain('timeoutMs: FETCH_TIMEOUT_MS');
  });
  test('waits between pages rather than hammering a host', () => {
    expect(src).toContain('DELAY_MS');
  });
  test('caps how much of a page is read', () => {
    expect(src).toContain('MAX_BYTES');
  });
});
