'use strict';

/**
 * The landing page's numbers, names and share card.
 *
 * Three things were wrong with it, and none of them looked wrong:
 *
 *   - "782 interns trained" was a literal. It was stale the day after it was
 *     typed, and a figure nobody can check is worth less than the smaller true
 *     one.
 *   - The testimonial pipeline was complete — students submit, HR publishes,
 *     GET /api/feedback/public serves — and no page had ever rendered it.
 *   - Sharing the link produced a bare URL with no title, description or
 *     image, which is most of the reach a landing page has.
 *
 * The risk in fixing the first two is putting student data on a public page,
 * so that is what most of this pins.
 */

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '../..');
const source = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const page = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');

/** Lift a function out of server.js, which cannot be required in a test. */
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

// eslint-disable-next-line no-new-func
const shortenPublicName = new Function(`${lift('shortenPublicName')}; return shortenPublicName;`)();

describe('a public page does not print a student\'s full name', () => {
  it('keeps the first name and initials the surname', () => {
    expect(shortenPublicName('Anmol Kumar')).toBe('Anmol K.');
    expect(shortenPublicName('neha priya sharma')).toBe('neha S.');
  });

  it('leaves a single name alone', () => {
    expect(shortenPublicName('Ravi')).toBe('Ravi');
  });

  it('never renders as blank', () => {
    // An empty card reads as a broken page.
    ['', '   ', null, undefined].forEach((v) => {
      expect(shortenPublicName(v)).toBe('A TEN intern');
    });
  });
});

describe('the public stats endpoint', () => {
  const at = source.indexOf("app.get('/api/public/stats'");
  const block = source.slice(at, at + 2600);

  it('exists once — not duplicated alongside a second one', () => {
    expect(at).toBeGreaterThan(-1);
    expect(source.indexOf("app.get('/api/public/stats'", at + 10)).toBe(-1);
    expect(source).not.toContain('app.get("/api/public-stats"');
  });

  it('returns top interns without an employee ID', () => {
    // /leaderboard/overall carries employeeId — the login identifier, printed
    // on every certificate. Advertising that from the front page would be new
    // harm, so this builds its own rows.
    expect(block).toContain('shortenPublicName');
    expect(block).toMatch(/top = topCoins\.map/);
    const topShape = block.slice(block.indexOf('top = topCoins.map'), block.indexOf('const body'));
    expect(topShape).not.toMatch(/employeeId/);
    expect(topShape).not.toMatch(/email/);
  });

  it('stays cached, because this is the busiest page on the site', () => {
    expect(block).toContain('_publicStatsCache');
    expect(source).toMatch(/PUBLIC_STATS_TTL_MS = \d+ \* 60 \* 1000/);
  });

  it('answers with a shape the page can use even when it fails', () => {
    expect(block).toContain("res.json({ success: false");
    expect(block).toMatch(/top: \[\]/);
  });
});

describe('the page shows real numbers instead of literals', () => {
  it('gives every stat an id to fill', () => {
    ['statInterns', 'statDomains', 'statTracks'].forEach((id) => {
      expect(page).toContain('id="' + id + '"');
    });
  });

  it('reads them from the endpoint', () => {
    expect(page).toContain('/api/public/stats');
  });

  it('leaves the printed figure as a fallback rather than a zero', () => {
    // A landing page that cannot reach its own API should look like the page
    // it was, not like a portal nobody has ever interned at.
    expect(page).toMatch(/id="statInterns"[^>]*>\d+</);
    expect(page).toContain('if (!d || !d.success) return;');
  });
});

describe('testimonials, at last rendered', () => {
  it('calls the endpoint that has existed with no consumer', () => {
    expect(page).toContain('/api/feedback/public');
  });

  it('reads the field names the route actually returns', () => {
    // { testimonials: [{ name, domain, rating, message }] }
    expect(page).toContain('d.testimonials');
    expect(page).toContain('f.message');
    expect(page).toContain('f.rating');
  });

  it('escapes what it renders', () => {
    // A testimonial is student-written text going into innerHTML on the most
    // public page in the product.
    expect(page).toContain('esc(f.message');
    expect(page).toContain('esc(t.name)');
    expect(page).toContain('.replace(/</g, "&lt;")');
  });

  it('hides the section entirely when nothing is published', () => {
    // An empty testimonial rail is worse than no rail.
    expect(page).toContain('id="voicesWrap" style="display:none;');
    expect(page).toContain('id="topWrap" style="display:none;');
  });
});

describe('the page can be shared', () => {
  it('carries Open Graph and Twitter cards', () => {
    ['og:title', 'og:description', 'og:image', 'og:url', 'og:type'].forEach((p) => {
      expect(page).toContain('property="' + p + '"');
    });
    expect(page).toContain('name="twitter:card"');
    expect(page).toContain('rel="canonical"');
  });

  it('points the share image at something that exists', () => {
    const m = page.match(/property="og:image"\s+content="[^"]*?(\/icons\/[^"]+)"/);
    expect(m).not.toBeNull();
    expect(fs.existsSync(path.join(root, 'public', m[1]))).toBe(true);
  });
});

describe('the small things that made it look unfinished', () => {
  it('has no links to the bare social networks', () => {
    // href="https://twitter.com" is a link to Twitter, not to TEN.
    expect(page).not.toMatch(/href="https:\/\/twitter\.com\/?"/);
    expect(page).not.toMatch(/href="https:\/\/instagram\.com\/?"/);
  });

  it('drops the emoji from the portal buttons', () => {
    // A strict black typographic page with 🎓🛡⚡📊 in the middle of it.
    ['🎓 Member', '🛡 Coordinator', '⚡ Coordinator', '📊 HR'].forEach((e) => {
      expect(page).not.toContain(e);
    });
  });

  it('surfaces the employer route above the footer', () => {
    // Both employer links now land in the founder portal itself. They used to
    // point at talent-network.html, a 2,000-line near-duplicate of
    // founder-os.html rendering placeholder data — so "Hire our interns" took
    // an employer to a dashboard with nothing behind it.
    const beforeFooter = page.slice(0, page.indexOf('<footer'));
    expect(beforeFooter).toContain('href="/founder-os"');
    expect(page).not.toContain('talent-network.html');
  });
});

describe('the kinetic grid behind the hero', () => {
  /*
   * A port of a React <KineticGrid> component to vanilla canvas, because this
   * page is plain HTML served by Express — there is no React, no Tailwind and
   * no /components/ui to drop a .tsx into.
   *
   * The two things that must not drift: the hero stays WHITE (the component
   * paints its own dark background, and that fill has to be absent here), and
   * the canvas never eats a click meant for the CTA underneath it.
   */
  const grid = page.slice(page.indexOf('KINETIC GRID'));

  it('paints no background of its own, so the white hero stays white', () => {
    // The component does `ctx.fillStyle = theme.bg; ctx.fillRect(...)` over the
    // whole canvas. Keeping that would turn the hero #161618.
    expect(page).toContain('.hero { background:#fff;');
    expect(grid).not.toMatch(/fillRect\(0,\s*0,\s*W,\s*H\)/);
    expect(grid).toContain('// No background fill.');
  });

  it('draws in the page\'s own ink, introducing no new colour', () => {
    const inks = grid.match(/const (?:LINE|NODE)_(?:BASE|ACTIVE)\s*=\s*\{[^}]+\}/g) || [];
    expect(inks.length).toBe(4);
    inks.forEach((line) => {
      expect(line).toMatch(/r:\s*10,\s*g:\s*10,\s*b:\s*10/);
    });
    expect(grid).toContain("const INK = '10,10,10'");
  });

  it('lives inside the hero rather than fixed over the whole page', () => {
    // The component uses `fixed inset-0`; the rest of this page scrolls past.
    expect(page).toContain('#heroGrid { position:absolute; inset:0;');
    expect(page).not.toMatch(/#heroGrid\s*\{[^}]*position:fixed/);
  });

  it('never takes a click away from the button underneath it', () => {
    expect(page).toMatch(/#heroGrid\s*\{[^}]*pointer-events:none/);
  });

  it('keeps the component\'s constants, so it behaves the same', () => {
    [['CELL_SIZE', 55], ['INFLUENCE_RADIUS', 260], ['MAX_WARP', 24],
     ['DOT_SPACING', 28], ['NODE_BASE_RADIUS', 1.8], ['NODE_ACTIVE_RADIUS', 3.2]]
      .forEach(([name, value]) => {
        expect(grid).toContain('const ' + name + ' = ' + value + ';');
      });
    expect(grid).toContain('const LERP_SPEED = 0.08;');
  });

  it('stops drawing when nobody is looking at it', () => {
    // A full-grid redraw every frame forever, for a hero that has scrolled
    // away, is somebody's battery.
    expect(grid).toContain('IntersectionObserver');
    expect(grid).toContain("document.addEventListener('visibilitychange'");
    expect(grid).toContain('function stop()');
  });

  it('is skipped entirely for a reader who asked for less movement', () => {
    expect(grid).toContain("matchMedia('(prefers-reduced-motion: reduce)').matches");
    // The loop never starts, and one flat pass is drawn instead.
    expect(grid).toContain('if (running || calm) return;');
    expect(grid).toContain('if (calm) {');
  });

  it('is decorative, and says so', () => {
    expect(page).toContain('<canvas id="heroGrid" aria-hidden="true">');
  });

  it('the wordmark reads the same field the grid does', () => {
    // One interaction, not two that happen to share a screen.
    expect(grid).toContain('window.__heroField');
    expect(grid).toContain('function publishField(');
    expect(page).toContain('const f = window.__heroField');
    expect(page).toContain("hero.style.transform =");
  });

  it('has exactly one writer for the wordmark\'s transform', () => {
    // Two handlers setting the same style property means whichever ran last
    // wins and the other looks broken.
    const writes = page.match(/hero\.style\.transform\s*=/g) || [];
    expect(writes.length).toBe(1);
  });
});

describe('the Domains link goes somewhere public, and the list is one list', () => {
  const domainsPage = fs.readFileSync(path.join(root, 'public/domains.html'), 'utf8');
  const journeys = fs.readFileSync(path.join(root, 'public/student-journeys.html'), 'utf8');
  const { DOMAINS } = require('../../config/domains');

  it('the home page points at /domains, not at a funnel step', () => {
    // student-journeys.html is "Step 2 of 3" with a payment banner. Sending a
    // visitor there from the front page drops them mid-signup.
    expect(page).toContain('href="/domains"');
    expect(page).not.toContain('href="student-journeys.html"');
  });

  it('the server serves the page and the list behind it', () => {
    expect(source).toContain("app.get('/domains'");
    expect(source).toContain("app.get('/api/public/domains'");
  });

  it('offers exactly the domains a student can register for', () => {
    // The old page advertised Vibe Coding, Space Research, Business Analyst
    // and HR Management — none registerable — and hid five that were.
    const at = source.indexOf("app.get('/api/public/domains'");
    const block = source.slice(at, at + 2600);
    expect(block).toContain('DOMAINS.filter(d => d.selectable)');
    expect(DOMAINS.filter((d) => d.selectable).length).toBeGreaterThan(0);
  });

  it('keeps no domain list of its own to drift', () => {
    // Every retired domain named in the page body would be a copy creeping back.
    DOMAINS.filter((d) => !d.selectable).forEach((d) => {
      expect(domainsPage).not.toContain('>' + d.name + '<');
    });
    expect(domainsPage).toContain('/api/public/domains');
  });

  it('still draws something when the list cannot be fetched', () => {
    expect(domainsPage).toContain('Could not load the domain list');
    // ...and the server answers from config even with no database.
    const at = source.indexOf("app.get('/api/public/domains'");
    expect(source.slice(at, at + 2600)).toMatch(/catch[\s\S]{0,400}selectable/);
  });

  it('the funnel page reads the same list instead of its own', () => {
    expect(journeys).toContain('/api/public/domains');
    expect(journeys).toContain('drawJourney');
  });

  it('respects a reader who asked for less movement', () => {
    expect(domainsPage).toContain('prefers-reduced-motion');
  });

  it('is reachable by keyboard, not just by pointer', () => {
    expect(domainsPage).toContain('tabindex="0"');
    expect(domainsPage).toContain('aria-expanded');
  });

  it('escapes the names and week titles it renders', () => {
    expect(domainsPage).toContain('esc(d.name)');
    expect(domainsPage).toContain('esc(w)');
  });
});
