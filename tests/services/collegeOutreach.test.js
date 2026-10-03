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
    // A bare domain becomes https, not http: nearly every .ac.in is TLS-only,
    // and starting on http costs a redirect hop on every one of the eight
    // requests per college.
    ['example.edu.in', 'https://example.edu.in'],
    ['https://www.example.edu.in/placements', 'https://www.example.edu.in'],
    ['  http://a.ac.in  ', 'http://a.ac.in']   // an explicit scheme is respected
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

  test('picks up the named officer beside the address, surname and all', () => {
    /*
     * This asserted "Dr Anita" until the brief became the authorities, and the
     * reasoning for leaving it was that chasing a surname risked the live job
     * agent for a cosmetic gain. Addressing a Vice-Chancellor as "Dear Dr
     * Anita" is not cosmetic, so nameNear() now matches the honorific without
     * capturing it. The job agent gets the same fix — "Contact Dr Priya Nair"
     * was losing the surname there too.
     */
    expect(rows()[0].name).toBe('Anita Rao');
  });

  test('a bare honorific is never returned as a name', () => {
    // "Prof. R Sharma" cannot be captured — the pattern wants two full words
    // and "R" is an initial — so the regex used to backtrack and return
    // "Prof". An empty name is honest; "Dear Prof" is not.
    const { nameNear } = require('../../services/v2/recruiterContacts');
    const t = 'For placements write to Prof. R Sharma at ';
    expect(nameNear(t, t.length)).toBe('');
    const u = 'Please contact The Office at ';
    expect(nameNear(u, u.length)).toBe('');
  });

  test('the relaxed pass keeps the human too', () => {
    /*
     * It used to push name:'', role:'', phone:'' — three hard-coded blanks —
     * so every address the strict rules missed arrived with nobody attached
     * and the preview could only say "Dear Sir/Madam".
     */
    const src = code('services/collegeDiscovery.js');
    const fn = src.slice(src.indexOf('function collegeContactsFrom'));
    const body = fn.slice(0, fn.indexOf('\n}'));
    expect(body).toMatch(/name: nameNear\(text, m\.index\)/);
    expect(body).toMatch(/role: collegeRoleNear\(text, m\.index\)/);
    expect(body).not.toMatch(/name: '',\s*role: ''/);
  });

  test('the role vocabulary is the college one, not the recruiter one', () => {
    // roleNear() knows "Talent Partner" and "Hiring Manager" and would never
    // match "Training and Placement Officer". Same job, different dictionary.
    const src = code('services/collegeDiscovery.js');
    expect(src).toMatch(/Training \(\?:and\|&\) Placement Officer/);
    expect(src).toMatch(/Vice\[- \]\?Chancellor/);
    expect(code('services/v2/recruiterContacts.js')).not.toMatch(/Placement Officer/);
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

describe('PLACEMENT_DESK ranks the right mailbox first', () => {
  test.each(['placement', 'tpo', 'training', 'careers', 'internship', 'corporate.relations'])
    ('%s@ is recognised as the placement office', (local) => {
      expect(discovery.PLACEMENT_DESK.test(local)).toBe(true);
    });

  test.each(['principal', 'library', 'admissions'])('%s@ is not the placement desk', (local) => {
    expect(discovery.PLACEMENT_DESK.test(local)).toBe(false);
  });

  /* Not the placement desk is not the same as not wanted. principal@ is an
     authority and is kept; library@ and admissions@ are neither. */
  test('principal@ is still collected, as an authority', () => {
    expect(discovery.isMailableDesk('principal@x.ac.in')).toBe(true);
    expect(discovery.isMailableDesk('library@x.ac.in')).toBe(false);
    expect(discovery.isMailableDesk('admissions@x.ac.in')).toBe(false);
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
    // Nothing routable reached the resolver, so nothing is counted unroutable.
    expect(res).toEqual({ added: 0, skipped: 3, unroutable: 0 });
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
    /*
     * Scoped to saveContacts. This used to police the WHOLE file for `$set:`,
     * which was a fair proxy while the file only ever inserted contacts — but
     * it is the contact rows that must never be overwritten, not every write
     * the file makes. The crawl's own bookkeeping legitimately updates a site
     * it has just visited; the test below is what keeps that honest.
     */
    const src = code('services/collegeDiscovery.js');
    const start = src.indexOf('async function saveContacts');
    const fn = src.slice(start, src.indexOf('\n}', src.indexOf('for (const row of valid)', start)));
    expect(start).toBeGreaterThan(-1);
    expect(fn).toContain('$setOnInsert');
    expect(fn).not.toMatch(/\$set:/);
  });

  test('nothing in discovery ever updates a CollegeContact in place', () => {
    /*
     * The property the assertion above was really protecting: a re-run must
     * not resurrect an address that opted out, reset a status, or overwrite a
     * contact name a human corrected. Stated against the collection rather
     * than against the file, so the crawl can keep its own notes.
     */
    const src = code('services/collegeDiscovery.js');
    const writes = src.match(/CollegeContact\.\w+\(/g) || [];
    expect(writes.sort()).toEqual(['CollegeContact.updateOne(']);
    const at = src.indexOf('CollegeContact.updateOne(');
    expect(src.slice(at, at + 220)).toContain('$setOnInsert');
    expect(src.slice(at, at + 220)).not.toMatch(/\$set:/);
  });

  test('the site queue may update itself, but only the queue', () => {
    const src = code('services/collegeDiscovery.js');
    const at = src.indexOf('async function markVisited');
    const fn = src.slice(at, src.indexOf('\n}', at));
    expect(fn).toMatch(/CollegeSite\.updateOne/);
    expect(fn).not.toMatch(/CollegeContact/);
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
    expect(body).toContain('Run the agent');   // names the path that works
    expect(body).toContain('curl ');           // and a way in that needs no SSH key
  });

  test('nothing promises a regulator download that does not exist', () => {
    // The docblock used to say AICTE publishes every approved institution with
    // its contact details as a downloadable CSV. AICTE publishes PDFs, and the
    // AICTE sets on data.gov.in are seat and enrolment statistics. Somebody
    // followed that sentence and spent an afternoon hunting for the file.
    const src = read('scripts/import-colleges.js') + read('config/collegeSeeds.js');
    expect(src).not.toMatch(/aicte\.csv|aicte\.xlsx/i);
    expect(src).not.toMatch(/Download the AICTE/i);
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
