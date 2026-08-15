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
    expect(page).toContain('word.style.transform =');
  });

  it('has exactly one writer for the wordmark\'s transform', () => {
    // Two handlers setting the same style property means whichever ran last
    // wins and the other looks broken.
    const writes = page.match(/(?:^|[^a-zA-Z])(?:word|hero)\.style\.transform\s*=/g) || [];
    expect(writes.length).toBe(1);
  });
});

describe('the reveal-on-scroll bug that blanked two sections', () => {
  /*
   * "How the internship works" and "Top interns right now" showed a heading
   * and nothing under it.
   *
   * One cause. The observer collected ONE fixed list of selectors, once, at
   * load. The four step cards, the employer band and the verify panel carry
   * class="reveal" in the markup but were not in that list, so nothing ever
   * observed them and they sat at opacity:0 forever. The top-intern rows and
   * the testimonials are worse: they are built from fetch responses, long
   * after the list was taken.
   */
  it('watches every .reveal, not a fixed selector list', () => {
    expect(page).toContain(".querySelectorAll('.reveal:not(.visible)').forEach(watch)");
  });

  it('keeps watching for ones added later', () => {
    // The rows the two blank sections needed are injected by fetch callbacks.
    expect(page).toContain('new MutationObserver(scan).observe(document.body');
  });

  it('shows anything that is already on screen when it appears', () => {
    // Injected into view, rather than below the fold: there may never be
    // another scroll event to trigger it.
    expect(page).toContain('if (r.top < innerHeight && r.bottom > 0) el.classList.add(\'visible\')');
  });

  it('gives injecting code a way to say so', () => {
    expect(page).toContain('window.revealScan = scan;');
  });

  it('keeps the marquee cards out of it', () => {
    // They sit in a track wider than the window that translates sideways
    // forever, so the ones past the right edge never intersect — give them
    // .reveal and half the loop stays invisible permanently.
    // The querySelectorAll line itself, not the block around it — the note
    // above it explains why .wcard is excluded and would match either way.
    const sel = page.match(/document\.querySelectorAll\('\.sec-head[^']*'\)/);
    expect(sel).not.toBeNull();
    expect(sel[0]).not.toContain('.wcard');
    expect(sel[0]).toContain('.drow');
  });

  it('no longer marks the injected rows invisible on the way in', () => {
    // The rendered row markup, not the note above it saying why.
    const at = page.indexOf("var row = function (t, i) {");
    const block = page.slice(at, at + 1200);
    expect(block).toContain('<div class="row">');
    expect(block).not.toContain('class=\\"reveal\\"');
  });
});

describe('the hero', () => {
  it('says the company name, not TEN TECH', () => {
    expect(page).toContain('aria-label="THE ENTREPRENEURSHIP NETWORK"');
    expect(page).not.toContain('aria-label="TEN TECH"');
  });

  it('scales the wordmark to fit any screen', () => {
    // SVG text with an explicit textLength shrinks to the viewBox on a phone.
    expect(page).toMatch(/<svg viewBox="0 0 1600 430"/);
    expect(page).toMatch(/textLength="1580" lengthAdjust="spacingAndGlyphs">ENTREPRENEURSHIP NETWORK/);
    expect(page).toMatch(/\.hero-word svg \{\s*width:100%; height:auto;/);
  });

  it('fits the mark in the viewport, not just across it', () => {
    /*
     * Width alone was not enough. Sized only from its own width, the two-line
     * mark grew tall enough on a wide screen to push ENTREPRENEURSHIP NETWORK
     * below the fold, so the page opened looking broken rather than looking
     * scrollable. The word now shrinks into the height that is left, and the
     * hands give up their room before the name does.
     */
    expect(page).toMatch(/\.hero-word \{[^}]*flex:0 1 auto/);
    expect(page).toMatch(/\.hero-word svg \{[^}]*max-height:min\(46vh, 520px\)/);
    expect(page).toMatch(/\.hero-hands \{[^}]*max-height:22vh/);
  });

  it('cross-fades the three textures behind the letters', () => {
    expect(page).toContain('<clipPath id="tclip">');
    expect(page).toMatch(/id="tex0"[\s\S]*?id="tex1"[\s\S]*?id="tex2"/);
    expect(page).toMatch(/const texs = \[0,1,2\]\.map/);
    expect(page).toMatch(/setInterval\(\(\) => show\(\(cur \+ 1\) % 3\), 4200\)/);
  });

  it('leaves the wordmark transform to the kinetic grid alone', () => {
    // Two handlers writing the same style property means the last one wins and
    // the other looks broken, so only the grid's follow loop may set it.
    expect(page.match(/word\.style\.transform/g) || []).toHaveLength(1);
    expect(page).not.toMatch(/hero\.style\.transform/);
  });
});

describe('the playful bits are gone', () => {
  it.each([
    ['the T\' corner mark', 'class="mark"'],
    ['the cursor blob', 'id="dot"'],
    ['click the logo', '<small>CLICK THE LOGO</small>'],
    ['touch a domain', '<h2>Touch a domain</h2>']
  ])('%s', (_label, needle) => {
    expect(page).not.toContain(needle);
  });

  it('the footer letters run from the cursor again (restored on request)', () => {
    expect(page).toContain("'TEN TECH'.split('')");
    expect(page).toContain('.flee span { display:inline-block;');
  });

  it('the opening counts down once and then gets out of the way', () => {
    // The intro is deliberate (PR #108) — 50 ticks at 58ms, then the E lands.
    // What matters here is that it always ends: the interval is cleared and
    // the body unlocks, so nothing can leave the page stuck behind the curtain.
    expect(page).toMatch(/let n = 50/);
    expect(page).toMatch(/clearInterval\(tick\)/);
    expect(page).toMatch(/document\.body\.classList\.remove\('locked'\)/);
  });
});

describe('what TEN gives', () => {
  it('slides on its own and stops under the cursor', () => {
    expect(page).toMatch(/marquee\(track\.parentElement, track, \d+\)/);
    expect(page).toContain("viewport.addEventListener('pointerenter', () => { hovering = true; })");
  });

  it('doubles the track in code, so a new card is written once', () => {
    expect(page).toContain('track.appendChild(c)');
    expect(page).toContain("c.setAttribute('aria-hidden', 'true')");
  });

  it('carries the new cards', () => {
    ['Become a Mentor', 'Become a Contractor', 'Hire from TEN', 'Hackathons', 'And TEN gives more']
      .forEach((t) => expect(page).toContain(t));
  });

  it('gives every card somewhere to go', () => {
    const track = page.slice(page.indexOf('id="giveTrack"'), page.indexOf('</section>', page.indexOf('id="giveTrack"')));
    const cards = track.match(/<a class="wcard[^>]*>/g) || [];
    expect(cards.length).toBeGreaterThanOrEqual(12);
    cards.forEach((c) => expect(c).toMatch(/href="[^"]+"/));
  });

  it('stops moving for a reader who asked for less movement', () => {
    // The drift is skipped, but the strip stays scrollable by hand — which is
    // better than the old rule, which unwrapped it into a static block.
    expect(page).toContain("const quiet = matchMedia('(prefers-reduced-motion: reduce)')");
    expect(page).toContain('if (!hovering && !quiet.matches && Date.now() >= idleUntil)');
  });
});

describe('the film\'s sound button', () => {
  it('no longer unmutes a video with no audio track', () => {
    expect(page).not.toContain("v.muted=!v.muted");
    expect(page).toContain('id="soundBtn"');
  });

  it('synthesises the ambience rather than shipping a track', () => {
    // No file, no licence, nothing to download.
    expect(page).toContain('AudioContext || window.webkitAudioContext');
    expect(page).toContain('createBiquadFilter');
    expect(page).toContain("o.type = 'sine'");
  });

  it('fades rather than snapping on and off', () => {
    expect(page).toContain('linearRampToValueAtTime');
  });

  it('never requests an optional file that is not there', () => {
    // Probing for one logs a 404 in every visitor's console on every click.
    expect(page).toContain("const AMBIENT_URL = '';");
    expect(page).toContain('if (audio === null && AMBIENT_URL)');
  });

  it('says which state it is in, to a screen reader too', () => {
    expect(page).toContain("btn.setAttribute('aria-pressed', String(on))");
  });
});

describe('the fourteen-domain circle', () => {
  it('brings the hovered domain to the middle', () => {
    expect(page).toContain('class="orbit-zoom" id="orbitZoom"');
    expect(page).toContain('.orbit-zoom.on { opacity:1;');
    expect(page).toContain("zoom.classList.add('on')");
  });

  it('is a separate element, not the chip scaled in place', () => {
    // The chip lives inside two counter-rotating parents; anything scaled
    // there inherits the spin.
    const css = page.slice(page.indexOf('.orbit-zoom {'), page.indexOf('.orbit-center { transition'));
    expect(css).toContain('position:absolute');
    expect(css).toContain('left:50%');
  });

  it('pauses the ring so it does not slide out from under the cursor', () => {
    expect(page).toContain('.orbit:hover .ring, .orbit:focus-within .ring { animation-play-state:paused; }');
  });

  it('answers the keyboard as well as the pointer', () => {
    expect(page).toContain("chip.addEventListener('focus', () => show(i))");
    expect(page).toContain("chip.addEventListener('blur', hide)");
  });
});

describe('the fourteen domain cards', () => {
  it('alternate which side they lead from', () => {
    expect(page).toContain('.drow:nth-child(2n) { grid-template-columns:1fr 190px; }');
    expect(page).toContain('.drow:nth-child(2n) .logo-box { order:2; }');
  });

  it('slide in from that side', () => {
    expect(page).toContain('.drow { opacity:0; transform:translateX(-64px);');
    expect(page).toContain('.drow:nth-child(2n) { transform:translateX(64px); }');
    expect(page).toContain('.drow.visible { opacity:1; transform:translateX(0); }');
  });

  it('carry their own accent colour', () => {
    expect(page).toContain("row.style.setProperty('--dc', c)");
    expect(page).toContain('color-mix(in srgb, var(--dc)');
  });

  it('have no click gimmick left', () => {
    ['anim-spin', 'anim-launch', 'anim-glow', 'steamup', "box.addEventListener('click'"]
      .forEach((g) => expect(page).not.toContain(g));
  });

  it('escape the copy they render', () => {
    const block = page.slice(page.indexOf('the fourteen domains ----'));
    expect(block).toContain('esc(n)');
    expect(block).toContain('esc(f)');
  });
});

describe('top interns and the four steps', () => {
  it('the interns strip slides and pauses', () => {
    expect(page).toContain('<div class="strip-vp"><div class="strip" id="topList">');
    expect(page).toMatch(/marquee\(document\.querySelector\("\.strip-vp"\), document\.getElementById\("topList"\), \d+\)/);
  });

  it('the rows are written once — the marquee clones only if they overflow', () => {
    expect(page).toContain('document.getElementById("topList").innerHTML = top.map(row).join("");');
    expect(page).not.toContain('top.map(row).join("") + top.map(row).join("")');
  });

  it('the four steps arrive one after another', () => {
    expect(page).toContain('.step.reveal { transition-delay:calc(var(--i,0) * 130ms); }');
    for (let i = 0; i < 4; i++) expect(page).toContain('--i:' + i);
  });

  it('a line joins them', () => {
    expect(page).toMatch(/\.steps::before \{[\s\S]*?content:''/);
  });
});

describe('contributors', () => {
  const Contributor = require('../../models/Contributor');
  const hr = fs.readFileSync(path.join(root, 'routes/v2/hr.js'), 'utf8');
  const hrPage = fs.readFileSync(path.join(root, 'public/hr-portal.html'), 'utf8');

  it('stores a copy, not a live join', () => {
    // The home page is the busiest request in the product, and it is public:
    // a live join would put whatever Student holds today on a page anyone can
    // read. What someone contributed also does not stop being true when they
    // leave.
    ['name', 'domain', 'contribution', 'photoUrl'].forEach((f) => {
      expect(Contributor.schema.paths[f]).toBeDefined();
    });
    expect(Contributor.schema.paths.name.isRequired).toBe(true);
  });

  it('is off until HR presses Post', () => {
    expect(Contributor.schema.paths.published.defaultValue).toBe(false);
  });

  it('the public endpoint serves published rows only, and only four fields', () => {
    const at = source.indexOf("app.get('/api/public/contributors'");
    expect(at).toBeGreaterThan(-1);
    const block = source.slice(at, at + 1600);
    expect(block).toContain('{ published: true }');
    expect(block).toMatch(/'name domain contribution photoUrl order'/);
    // Not the employee ID, not who posted it, not the student's _id.
    const shape = block.slice(block.indexOf('contributors: rows.map'), block.indexOf('_contribCache = {'));
    ['employeeId', 'studentId', 'postedBy'].forEach((f) => expect(shape).not.toContain(f));
  });

  it('answers with an empty list rather than a 500', () => {
    const at = source.indexOf("app.get('/api/public/contributors'");
    const block = source.slice(at, at + 1600);
    expect(block).toContain('res.json({ success: true, contributors: [] })');
  });

  it('does not make the home page wait five minutes for a new one', () => {
    expect(source).toContain("app.set('clearContributorCache'");
    expect(hr).toContain('const clearCache = (req) =>');
  });

  it('the HR side is behind the HR session', () => {
    ['/contributors', '/contributors/lookup/:employeeId'].forEach((r) => {
      expect(hr).toContain('requireHR');
    });
    expect(hr).toMatch(/router\.post\("\/contributors", requireHR/);
    expect(hr).toMatch(/router\.delete\("\/contributors\/:id", requireHR/);
  });

  it('accepts images only, checking extension and mimetype together', () => {
    // Either alone is trivially lied about.
    const at = hr.indexOf('const photoUpload = multer(');
    const block = hr.slice(at, hr.indexOf('const clearCache'));
    expect(block).toContain('.webp');
    expect(block).toContain('/^image\\/(jpeg|png|webp)$/');
    expect(block).toContain('okExt && okMime');
  });

  it('the lookup fills the form from the student record', () => {
    expect(hrPage).toContain('async function contribLookup()');
    expect(hrPage).toContain('/api/v2/hr/contributors/lookup/');
    expect(hrPage).toContain("cbEl('cbName').value = d.student.name");
  });

  it('is a Level 5 screen and above', () => {
    // Level 5 is HR Associate Director.
    const levels = hrPage.match(/^\s+(\d): \{[\s\S]*?views: \[([^\]]*)\]/gm) || [];
    const has = (n) => {
      const m = hrPage.match(new RegExp('\\n  ' + n + ': \\{[\\s\\S]*?views: \\[([^\\]]*)\\]'));
      return m ? m[1].includes("'contributors'") : false;
    };
    [5, 6, 7, 8].forEach((n) => expect(has(n)).toBe(true));
    [1, 2, 3, 4].forEach((n) => expect(has(n)).toBe(false));
  });

  it('the strip hides itself when nobody has been posted', () => {
    expect(page).toContain('id="contribWrap" style="display:none;');
    expect(page).toContain('if (!Array.isArray(list) || !list.length) return;');
  });

  it('escapes every field it prints', () => {
    const block = page.slice(page.indexOf('/api/public/contributors'));
    ['esc(c.name)', 'esc(c.domain)', 'esc(c.contribution)', 'esc(c.photoUrl)']
      .forEach((e) => expect(block).toContain(e));
  });
});

describe('founder registration is open', () => {
  const reg = fs.readFileSync(path.join(root, 'public/register.html'), 'utf8');

  it('no longer blocks the founder card', () => {
    expect(reg).toContain("if (['investor', 'contractor'].includes(role)) {");
    expect(reg).not.toContain("if (['founder', 'investor', 'contractor'].includes(role)) {");
  });

  it('has a real form behind it', () => {
    expect(reg).toContain('id="founderStep2"');
    expect(reg).toContain('id="founderStep3"');
    ['fnd_startupName', 'fnd_industry', 'fnd_stage', 'fnd_teamSize', 'fnd_website', 'fnd_description']
      .forEach((id) => expect(reg).toContain('id="' + id + '"'));
    expect(reg).toContain('class="fnd-goal accent-amber-500"');
  });

  it('is three steps, not the student\'s six', () => {
    expect(reg).toContain("activeRole === 'founder' ? 3 : 6");
    expect(reg).toContain("{ 1: 'wizardStep1', 2: 'founderStep2', 3: 'founderStep3' }");
  });

  it('will not submit an empty startup', () => {
    const at = reg.indexOf("if (activeRole === 'founder') {\n        if (step === 2)");
    expect(at).toBeGreaterThan(-1);
    const block = reg.slice(at, at + 900);
    expect(block).toContain('Startup name');
    expect(block).toContain('Industry');
    expect(block).toContain('.fnd-goal:checked');
  });

  it('sends the shape the controller already reads', () => {
    // registerHubController maps roleSpecificData.goals through its lookingFor
    // enum by splitting on commas.
    const at = reg.indexOf("if (activeRole === 'founder') {\n        payload = {");
    expect(at).toBeGreaterThan(-1);
    const block = reg.slice(at, at + 1200);
    ['startupName', 'industry', 'stage', 'fundingStage', 'teamSize', 'website', 'description', 'goals']
      .forEach((f) => expect(block).toContain(f + ':'));
    expect(block).toContain(".join(',')");
  });

  it('leaves investor and contractor closed', () => {
    // Their portals do not exist; a door to an empty room is worse than a badge.
    const investor = reg.slice(reg.indexOf("selectRole('investor')"), reg.indexOf("selectRole('contractor')"));
    expect(investor).toContain('Coming Soon');
    const contractor = reg.slice(reg.indexOf("selectRole('contractor')"));
    expect(contractor.slice(0, 1200)).toContain('Coming Soon');
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

describe('START MY JOURNEY actually goes somewhere', () => {
  it('the curtain stops eating clicks the moment it is done', () => {
    // It slides away over .9s. Until pointer-events went off, it sat over the
    // hero for that whole second and swallowed the button.
    expect(page).toMatch(/#pre\.done \{[^}]*pointer-events:none/);
  });

  it('the handler unlocks the body before it scrolls', () => {
    const fn = page.slice(page.indexOf('function journey()'), page.indexOf('function journey()') + 600);
    expect(fn).toContain("document.body.classList.remove('locked')");
    expect(fn).toContain("join.scrollIntoView({ behavior: 'smooth' })");
  });

  it('falls back to registration if the target section is missing', () => {
    const fn = page.slice(page.indexOf('function journey()'), page.indexOf('function journey()') + 600);
    expect(fn).toMatch(/if \(!join\).*register\.html/s);
  });

  it('the section it scrolls to exists exactly once', () => {
    expect(page.match(/id="join"/g)).toHaveLength(1);
  });
});

describe('the one-line people band', () => {
  it('no longer repeats the footer beside it', () => {
    const band = page.slice(page.indexOf('<section class="people">'), page.indexOf('<!-- join:'));
    expect(band).not.toContain('FOUNDERS &amp; MANAGEMENT');
    expect(band).not.toContain('FOR STUDENTS');
    expect(band).not.toContain('CONTACT');
    expect(band).not.toContain('info@entrepreneurshipnetwork.net');
  });

  it('keeps the line, and only the line', () => {
    const band = page.slice(page.indexOf('<section class="people">'), page.indexOf('<!-- join:'));
    expect(band).toContain("TEN' WITHOUT PEOPLE");
    expect(band).toContain('<span>is</span> <span>nothing.</span>');
  });

  it('the words rise one after the other, and the rule draws itself', () => {
    expect(page).toContain('.people-inner.visible .people-line span { opacity:1; transform:none; }');
    expect(page).toMatch(/\.people-inner\.visible \.people-line span:nth-child\(2\) \{ transition-delay/);
    expect(page).toContain('.people-inner.visible .people-rule { transform:scaleX(1); }');
  });

  it('sits still for a reader who asked for less movement', () => {
    const rm = page.slice(page.indexOf('.people-inner.visible .people-rule'));
    expect(rm).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]{0,240}\.people-line span \{ opacity:1/);
  });
});

describe('the hero mark', () => {
  it('stays dark enough to read on a white page', () => {
    // A light texture used to fill the glyphs outright and the name vanished.
    expect(page).toContain('<linearGradient id="inkGrad"');
    expect(page).toMatch(/id="tex0"[^>]*opacity="0\.26"/);
    expect(page).toMatch(/j === i \? '0\.26' : '0'/);
    expect(page).toContain('<linearGradient id="rimGrad"');
  });

  it('wipes in behind a mask instead of just appearing', () => {
    expect(page).toContain('<mask id="wipeMask">');
    expect(page).toContain('<rect class="wipe"');
    expect(page).toMatch(/\.wipe \{[^}]*transform:scaleX\(0\)/);
    expect(page).toContain('@keyframes wipeIn');
  });

  it('runs a raked gold glint through the letters on a loop', () => {
    expect(page).toContain('<linearGradient id="glintGrad"');
    // The skew must be on the wrapping group: a CSS transform on the rect
    // replaces its transform attribute rather than composing with it.
    expect(page).toMatch(/<g transform="skewX\(-12\)">\s*<rect class="glint"/);
    expect(page).toContain('@keyframes glintRun');
  });

  it('drops the hands in and then lets them breathe', () => {
    expect(page).toContain('class="hero-hands"');
    expect(page).toContain('@keyframes handsIn');
    expect(page).toContain('@keyframes handsFloat');
  });

  it('keeps its entrance off the div the kinetic grid drives', () => {
    // #heroWord's transform is rewritten every frame; an entrance animation
    // there would be overwritten, so it belongs on the <svg> inside it.
    expect(page).toMatch(/\.hero-word svg \{[^}]*animation:wordIn/);
    expect(page).not.toMatch(/\.hero-word \{[^}]*animation:/);
  });

  it('holds still for a reader who asked for less movement', () => {
    const rm = page.slice(page.indexOf('@keyframes glintRun'));
    expect(rm).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]{0,300}\.hero-hands \{ animation:none/);
    expect(rm).toMatch(/\.wipe \{ transform:scaleX\(1\); animation:none/);
  });
});

describe('the printed intern count', () => {
  // eslint-disable-next-line no-new-func
  const publicInternCount = new Function(
    'PUBLIC_INTERNS_FLOOR', 'PUBLIC_INTERNS_FLOOR_AT',
    `${lift('publicInternCount')}; return publicInternCount;`
  );

  it('starts at the floor and then moves one for one with real signups', () => {
    const f = publicInternCount(5000, 783);
    expect(f(783)).toBe(5000);
    expect(f(784)).toBe(5001);
    expect(f(785)).toBe(5002);
    expect(f(1783)).toBe(6000);
  });

  it('is an offset, not a multiplier — every real signup counts exactly once', () => {
    const f = publicInternCount(5000, 783);
    expect(f(900) - f(899)).toBe(1);
    expect(f(5000) - f(783)).toBe(5000 - 783);
  });

  it('never prints less than the raw count', () => {
    // A floor below the real count must not shrink the number.
    const f = publicInternCount(100, 783);
    expect(f(783)).toBe(783);
    expect(f(900)).toBe(900);
  });

  it('prints the raw count when the floor is switched off', () => {
    const f = publicInternCount(0, 783);
    expect(f(783)).toBe(783);
  });

  it('survives a missing or junk count', () => {
    const f = publicInternCount(5000, 783);
    [undefined, null, NaN, 'abc'].forEach(v => expect(f(v)).toBe(4217));
  });

  it('is the only number the endpoint dresses up', () => {
    const at = source.indexOf("app.get('/api/public/stats'");
    const body = source.slice(source.indexOf('const body = {', at), source.indexOf('_publicStatsCache = {', at));
    expect(body).toContain('interns: publicInternCount(interns)');
    // domains and tracks are real and checkable; they stay raw.
    expect(body).toMatch(/domains: SELECTABLE_DOMAIN_NAMES\.length/);
    expect(body).toMatch(/tracks: 6/);
    expect(body).not.toMatch(/certificates: publicInternCount/);
  });

  it('the page falls back to the floor, not to a stale raw figure', () => {
    expect(page).toMatch(/id="statInterns">5000</);
  });

  it('both knobs are env-overridable', () => {
    expect(source).toContain('process.env.PUBLIC_INTERNS_FLOOR');
    expect(source).toContain('process.env.PUBLIC_INTERNS_FLOOR_AT');
  });
});

describe('the sideways strips', () => {
  it('all three go through one helper, none through a CSS animation', () => {
    expect(page).toContain('function marquee(viewport, track, pxPerSec)');
    // The old mechanism could not be scrolled by hand — nothing to grab.
    expect(page).not.toContain('animation:slide');
    expect(page).not.toContain('@keyframes slide');
    ['track.parentElement, track', '".strip-vp"', '".contrib-vp"'].forEach((s) => {
      expect(page).toContain(s);
    });
  });

  it('shows a short list once instead of repeating it', () => {
    // One contributor posted by HR filled the rail four times over.
    expect(page).not.toMatch(/var reps = list\.length < 5 \? 4 : 2/);
    expect(page).toContain('document.getElementById("contribList").innerHTML = list.map(card).join("");');
    expect(page).toMatch(/if \(track\.scrollWidth <= viewport\.clientWidth \+ 2\) \{[\s\S]{0,120}mq-fits/);
  });

  it('only clones when the content actually overflows', () => {
    const fn = page.slice(page.indexOf('function marquee('), page.indexOf('/* ---- what TEN gives ---- */'));
    // The fits-check returns before any clone is made.
    expect(fn.indexOf('mq-fits')).toBeLessThan(fn.indexOf('cloneNode(true)'));
    expect(fn).toContain("c.setAttribute('data-mq-clone', '')");
    // And a rebuild clears the previous run's clones rather than stacking them.
    expect(fn).toContain("track.querySelectorAll('[data-mq-clone]').forEach(n => n.remove())");
  });

  it('is a real scroll container, so wheel and touch work', () => {
    expect(page).toContain('.mq { overflow-x:auto;');
    expect(page).toMatch(/\.mq\.mq-live \{ cursor:grab; touch-action:pan-x; [^}]*user-select:none/);
    expect(page).toContain('.mq::-webkit-scrollbar { display:none; }');
  });

  it('can be dragged, and the drag does not open the card underneath', () => {
    const fn = page.slice(page.indexOf('function marquee('), page.indexOf('/* ---- what TEN gives ---- */'));
    expect(fn).toContain('setScroll(startScroll - dx)');
    expect(fn).toMatch(/if \(moved > DRAG_SLOP\) \{ e\.preventDefault\(\); e\.stopPropagation\(\)/);
  });

  it('pauses while the reader is scrolling and picks up again after', () => {
    const fn = page.slice(page.indexOf('function marquee('), page.indexOf('/* ---- what TEN gives ---- */'));
    expect(fn).toMatch(/const RESUME_AFTER = \d+/);
    expect(fn).toContain('const still = () => { idleUntil = Date.now() + RESUME_AFTER; };');
    ['scroll', 'wheel', 'pointerdown'].forEach((ev) => {
      expect(fn).toContain("viewport.addEventListener('" + ev + "'");
    });
  });

  it('wraps in both directions so scrolling back does not hit a wall', () => {
    const fn = page.slice(page.indexOf('function marquee('), page.indexOf('/* ---- what TEN gives ---- */'));
    expect(fn).toContain('if (viewport.scrollLeft >= h) setScroll(viewport.scrollLeft - h);');
    expect(fn).toContain('else if (viewport.scrollLeft <= 0) setScroll(h);');
  });

  it('keeps pace fixed in pixels per second, not per lap', () => {
    // A fixed duration made a longer strip scroll faster, so adding one card
    // silently sped the whole rail up.
    const fn = page.slice(page.indexOf('function marquee('), page.indexOf('/* ---- what TEN gives ---- */'));
    expect(fn).toContain('carry += (pxPerSec * dt) / 1000;');
    // Sub-pixel steps are carried, not rounded away to a standstill.
    expect(fn).toContain('const step = Math.floor(carry);');
    // And a backgrounded tab must not lurch forward on return.
    expect(fn).toContain('Math.min(now - last, 100)');
  });

  it('gives contributors the quicker pace that was asked for', () => {
    const speed = (id) => Number(page.match(
      new RegExp('marquee\\(document\\.querySelector\\("\\.[a-z-]+"\\), document\\.getElementById\\("'
        + id + '"\\), (\\d+)\\)'))[1]);
    expect(speed('contribList')).toBeGreaterThan(speed('topList'));
  });
});
