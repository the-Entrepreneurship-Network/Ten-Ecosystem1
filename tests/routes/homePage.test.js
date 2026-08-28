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
    // The intro is deliberate (PR #108). The step count used to be a literal
    // 50 and is now derived from INTRO_MS, so this no longer pins the number —
    // the point of this test was never the count. What matters is that it
    // always ends: the interval is cleared and the body unlocks, so nothing
    // can leave the page stuck behind the curtain.
    expect(page).toMatch(/let n = COUNT_FROM/);
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
    expect(cards.length).toBeGreaterThanOrEqual(10);
    cards.forEach((c) => expect(c).toMatch(/href="[^"]+"/));
  });

  /*
   * The Job and Resume portals are sold inside the Career Studio, and the gate
   * in front of them sends anyone who clicks straight to a paywall. A front
   * page should not advertise a locked door.
   */
  it('does not send a visitor at the two portals they cannot open', () => {
    expect(page).not.toContain('href="job-portal/"');
    expect(page).not.toContain('href="resume-portal/"');
  });

  it('stops moving for a reader who asked for less movement', () => {
    // The drift is skipped, but the strip stays scrollable by hand — which is
    // better than the old rule, which unwrapped it into a static block.
    expect(page).toContain("const quiet = matchMedia('(prefers-reduced-motion: reduce)')");
    expect(page).toContain('if (!hovering && !quiet.matches && Date.now() >= idleUntil)');
  });
});

describe('the film has no sound control, and neither does anything else', () => {
  /*
   * The film used to carry a SOUND button that faded a synthesised drone in
   * and out — a reasonable answer to "the video has no audio track", and one
   * more thing on the page asking to be switched on. The opening has exactly
   * one sound now, built in and fired by the break, so every other control
   * and everything behind them came out.
   */
  // Just the film's audio block — `btn` is a name several scripts on this page
  // use, so an assertion about listeners has to be scoped to this one.
  const audioBlock = page.slice(
    page.indexOf("const film = document.getElementById('filmSection');"),
    page.indexOf("film.addEventListener('click', toggle);") + 60
  );

  it('the film carries its own sound, on a click', () => {
    // One handler, on the section, so the whole film is the control. The
    // button's click bubbles into it — a second listener on the button would
    // fire both and cancel itself out.
    expect(audioBlock).toContain("film.addEventListener('click', toggle);");
    expect(audioBlock).not.toMatch(/btn\.addEventListener\('click'/);
    expect(page).toMatch(/on = !on;/);
    // Synthesised: nothing to serve, nothing to license.
    expect(page).not.toContain('AMBIENT_URL');
    expect(audioBlock).toMatch(/lfo\.frequency\.value = 0\.07/);   // the slow breath
    // Faded, never switched: a level that jumps is heard as a fault.
    expect(audioBlock).toMatch(/const fade = \(to, secs\)/);
  });

  /*
   * Why it could not be switched off.
   *
   * The tremolo LFO was connected straight to `master.gain`. An AudioParam
   * that has an input connected is worth its own value PLUS that input, so the
   * LFO's ±0.03 rode on top of master no matter what master was set to, and
   * fading the intrinsic value to silence left a third of the level still
   * swinging — for ever. Measured in Chromium before the fix: 0.109 while
   * playing, 0.030 after "off". On its own gain stage it multiplies instead of
   * adding, so master alone decides the level. After: 0.00009.
   */
  it('routes the tremolo through its own stage, not through master.gain', () => {
    expect(audioBlock).not.toContain('lfoGain).connect(master.gain)');
    expect(audioBlock).toMatch(/lfo\.connect\(lfoGain\)\.connect\(trem\.gain\)/);
    expect(audioBlock).toMatch(/lp\.connect\(trem\)\.connect\(master\)\.connect\(ctx\.destination\)/);
  });

  it('stops the clock once the fade has landed, not just the level', () => {
    // Inaudible is not the same as stopped, and an oscillator nobody can hear
    // still costs a phone battery.
    expect(audioBlock).toMatch(/if \(!on\) offTimer = setTimeout\(\(\) => \{ if \(!on\) ctx\.suspend\(\); \}/);
    // A toggle back on during that wait must cancel the pending suspend.
    expect(audioBlock).toMatch(/clearTimeout\(offTimer\)/);
  });

  it('carries none of the old sound machinery', () => {
    expect(page).not.toContain('id="soundBtn"');
    expect(page).not.toMatch(/\bbuildTones\b/);
  });

  describe('the sound control', () => {
    const markup = page.slice(page.indexOf('<section class="film"'), page.indexOf('<!-- scroll words -->'));

    it('is a real button, so a keyboard and a screen reader can both use it', () => {
      expect(markup).toMatch(/<button type="button" class="sound-toggle" id="filmSound"/);
      expect(markup).toContain('aria-pressed="false"');
      expect(audioBlock).toMatch(/btn\.setAttribute\('aria-pressed', String\(on\)\)/);
    });

    // A <button> inside a role="button" is invalid, and the button now
    // provides the keyboard route the section's tabindex used to.
    it('leaves the section itself a plain section', () => {
      const openTag = markup.slice(0, markup.indexOf('>') + 1);
      expect(openTag).not.toContain('role="button"');
      expect(openTag).not.toContain('tabindex');
      expect(page).not.toMatch(/e\.key === 'Enter' \|\| e\.key === ' '/);
    });

    it('shows the state in the meter, not only in the wording', () => {
      expect(page).toContain('<span class="eq" aria-hidden="true">');
      expect(page).toMatch(/\.film\.sounding \.eq i \{ opacity:1; animation:eqbar/);
      expect(page).toMatch(/@keyframes eqbar/);
      // The bars only move while it is playing.
      expect(page).not.toMatch(/\n\s*\.eq i \{[^}]*animation:eqbar/);
    });

    it('is big enough to hit with a thumb', () => {
      expect(page).toMatch(/\.sound-toggle \{[\s\S]{0,400}min-height:44px/);
    });

    it('says how to stop it, which is the half that was missing', () => {
      expect(page).toContain("hint.textContent = on ? 'sound on — click to stop' : 'click for sound'");
    });

    it('holds still for anyone who asked for less motion', () => {
      const rm = page.slice(page.indexOf('@media (prefers-reduced-motion:reduce) {\n    .sound-toggle'));
      expect(rm.slice(0, 320)).toContain('.film.sounding .eq i { animation:none;');
      expect(rm.slice(0, 320)).toContain('.film.sounding .sound-toggle::after { animation:none;');
    });
  });

  it('leaves the film muted, which is what an autoplaying video is for', () => {
    expect(page).not.toContain('v.muted=!v.muted');
    expect(page).toMatch(/<video id="film"[^>]*\bmuted\b/);
  });
});

describe('every sideways strip has a way back', () => {
  /*
   * The strip drifts on its own and can be dragged. Neither helps a visitor
   * who wants the card that has just gone past: a plain mouse wheel does
   * nothing sideways, so the only way back was to wait for the loop.
   *
   * Built inside marquee(), so all three strips on this page get arrows from
   * one place instead of three copies that drift apart.
   */
  it('builds the arrows in the shared helper, not per strip', () => {
    const fn = page.slice(page.indexOf('function marquee(viewport, track, pxPerSec)'),
                          page.indexOf('function wrapOnce(viewport)'));
    expect(fn).toContain("b.className = 'mq-arrow mq-arrow-'");
    expect(fn).toMatch(/aria-label', dir < 0 \? 'Show previous cards' : 'Show next cards'/);
    // Only strips that actually overflow: everything after the mq-fits return.
    expect(fn.indexOf('mq-fits')).toBeLessThan(fn.indexOf('mq-arrow'));
  });

  // Anything absolutely positioned INSIDE a scroll container scrolls away with
  // the content, so the viewport gets a positioned wrapper of its own.
  it('pins them to a wrapper, not inside the scroller', () => {
    expect(page).toContain('function wrapOnce(viewport)');
    expect(page).toMatch(/\.mq-host \{ position:relative; \}/);
    expect(page).toMatch(/\.mq-arrow \{ position:absolute/);
  });

  // These strips are re-marqueed when their fetch lands. A wrapper per rebuild
  // would nest for ever, and arrows per rebuild would stack up.
  it('wraps once, however many times the strip is rebuilt', () => {
    const fn = page.slice(page.indexOf('function wrapOnce(viewport)'));
    expect(fn.slice(0, 700)).toContain("if (parent.classList.contains('mq-host'))");
    expect(fn.slice(0, 700)).toContain("parent.querySelectorAll('[data-mq-arrow]').forEach(n => n.remove())");
  });

  /*
   * Native smooth scrolling is cancelled the moment wrap() writes scrollLeft
   * at the loop point, so an arrow press that crossed the seam would stop dead
   * halfway. The tween applies a DIFFERENCE each frame rather than an absolute
   * target, so a wrap in the middle of it is invisible instead of a jump back.
   */
  it('moves it the way the drift does, not with native smooth scroll', () => {
    const fn = page.slice(page.indexOf('const glide = (delta)'), page.indexOf('[-1, 1].forEach'));
    expect(fn).not.toMatch(/behavior:\s*'smooth'/);
    expect(fn).toContain('setScroll(viewport.scrollLeft + (want - applied))');
    expect(fn).toContain('wrap();');
  });

  it('holds still for anyone who asked for less motion', () => {
    const fn = page.slice(page.indexOf('const glide = (delta)'), page.indexOf('[-1, 1].forEach'));
    expect(fn).toContain('if (quiet.matches) { setScroll(viewport.scrollLeft + delta); wrap(); return; }');
  });

  // The viewports carry bottom padding, and half of it is how far off-centre
  // an arrow would otherwise sit.
  it('centres them on the cards, not on the padded box', () => {
    expect(page).toContain("host.style.setProperty('--mq-arrow-shift', (-padBottom / 2) + 'px')");
    expect(page).toMatch(/transform:translateY\(calc\(-50% \+ var\(--mq-arrow-shift, 0px\)\)\)/);
  });

  it('is a real button, reachable by keyboard', () => {
    const fn = page.slice(page.indexOf('[-1, 1].forEach'), page.indexOf('function wrapOnce'));
    expect(fn).toContain("b.type = 'button'");
    expect(page).toContain('.mq-arrow:focus-visible');
  });
});

describe('the way in to Academics', () => {
  const dash = fs.readFileSync(path.join(__dirname, '../../public/student-dashboard.html'), 'utf8');
  const academics = fs.readFileSync(path.join(__dirname, '../../public/academics.html'), 'utf8');

  /*
   * It used to take three pages to start learning: the portal, then the
   * cinematic Academics preview, then START LEARNING to the studio. The
   * preview is good marketing for a visitor and a wall for a student who has
   * already signed in.
   */
  it('a signed-in student reaches the studio in one hop', () => {
    expect(dash).not.toContain("window.location.href='/academics'");
    expect(dash).toContain("window.location.href='/student-portal/'");
  });

  it('a visitor still gets the cinematic preview from the home page', () => {
    expect(page).toContain('<a class="wcard" href="academics.html">');
  });

  /*
   * One button. "Pay & unlock" sat beside "Start learning" sending people into
   * the same funnel under a second name, asking for money before the page had
   * said what the money buys — and payment.html, the bare amount box it once
   * pointed at, stays gone.
   */
  it('leads with the one button, and never at a bare amount box', () => {
    expect(academics).not.toContain('href="payment.html"');
    expect(academics).not.toContain('PAY &amp; UNLOCK');
    expect(academics).toContain('<a class="nh-pill" href="student-portal/">START LEARNING');
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

  it('no longer blocks any of the three cards', () => {
    // The gate used to return early for every non-student role, so clicking
    // Founder, Investor or Contractor did nothing at all.
    expect(reg).not.toContain("includes(role)) {\n          return;");
    expect(reg).not.toContain('Coming Soon');
  });

  it('has a real form behind it', () => {
    expect(reg).toContain('id="founderStep2"');
    expect(reg).toContain('id="founderStep3"');
    ['fnd_startupName', 'fnd_industry', 'fnd_stage', 'fnd_teamSize', 'fnd_website', 'fnd_description']
      .forEach((id) => expect(reg).toContain('id="' + id + '"'));
    expect(reg).toContain('class="fnd-goal accent-amber-500"');
  });

  /*
   * maxSteps was written out three times and two copies said
   * `activeRole === 'founder' ? 3 : 6`. For an investor or a contractor that
   * made step 3 not the last step: the review summary never ran, the Submit
   * button never appeared, and the submit path validated against the student's
   * step 6. The wizard simply ended with no way out of it.
   */
  it('knows how many steps each role has, in one place', () => {
    expect(reg).toContain('function stepsFor(role)');
    expect(reg).not.toContain("activeRole === 'mentor' ? 5 : activeRole === 'founder' ? 3 : 6");
    expect((reg.match(/stepsFor\(activeRole\)/g) || []).length).toBe(3);
  });

  /*
   * SHORT was a const inside changeWizardStep while renderWizardStep — a
   * sibling function — read it too, so the first Next click threw a
   * ReferenceError and stranded every role on step 1.
   */
  it('declares SHORT where both wizard functions can see it', () => {
    const decl = reg.indexOf("const SHORT = ['founder', 'investor', 'contractor'];");
    const render = reg.indexOf('function renderWizardStep');
    const change = reg.indexOf('function changeWizardStep');
    expect(decl).toBeGreaterThan(-1);
    expect(decl).toBeLessThan(Math.min(render, change));
  });

  it('is three steps for all three, not the student\'s six', () => {
    expect(reg).toContain("const SHORT = ['founder', 'investor', 'contractor'];");
    expect(reg).toContain("SHORT.includes(role) ? 3 : 6");
    // One panel map for the three, keyed off the role — the founder-only
    // literal it replaced had to be copied twice to open the other two.
    expect(reg).toContain("2: activeRole + 'Step2'");
    expect(reg).toContain("3: activeRole + 'Step3'");
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

  it('opens investor and contractor too, with real forms behind them', () => {
    // Both portals were fully built and unreachable: the badge said "coming
    // soon" over three finished dashboards.
    ['investorStep2', 'investorStep3', 'contractorStep2', 'contractorStep3']
      .forEach((id) => expect(reg).toContain('id="' + id + '"'));
    ['inv_firmName', 'inv_investorType', 'inv_industryFocus', 'inv_ticketMin', 'inv_ticketMax']
      .forEach((id) => expect(reg).toContain('id="' + id + '"'));
    // Stages are the four the schema stores, as checkboxes: the old single
    // select offered "Growth", which is not one of them, so choosing it saved
    // nothing and hid the investor from every stage filter.
    ['pre_seed', 'seed', 'series_a', 'series_b']
      .forEach((v) => expect(reg).toContain('class="inv-stage accent-amber-500" value="' + v + '"'));
    ['con_skills', 'con_experience', 'con_hourlyRate', 'con_availability']
      .forEach((id) => expect(reg).toContain('id="' + id + '"'));
    expect(reg).toContain("} else if (activeRole === 'investor') {");
    expect(reg).toContain("} else if (activeRole === 'contractor') {");
  });

  it('a ?role= link lands on the role it names', () => {
    // prefillFromQuery used to bail out for every role but student, so the
    // home page's "Hire our interns" link opened the student wizard.
    expect(reg).toContain("var KNOWN = ['student', 'founder', 'mentor', 'investor', 'contractor'];");
    // Comments quote the old guard, so match on live code only.
    const code = reg.replace(/\/\*[\s\S]*?\*\//g, '');
    expect(code).not.toContain("if (role !== 'student' && !domain) return;");
  });
});

describe('the Domains link goes somewhere public, and the list is one list', () => {
  const domainsPage = fs.readFileSync(path.join(root, 'public/domains.html'), 'utf8');
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

  /*
   * The funnel page is gone. student-journeys.html was "Step 2 of 3" with a
   * payment banner and its own hardcoded list of fourteen domains that had
   * already drifted from the real one; /domains reads config/domains.js and is
   * a page a visitor can land on cold.
   *
   * Its URL is in bookmarks, in search results and inside a built bundle whose
   * cache we do not control, so it redirects rather than 404s.
   */
  it('the old funnel page is gone, and its URL still lands somewhere', () => {
    expect(fs.existsSync(path.join(root, 'public/student-journeys.html'))).toBe(false);
    expect(source).toContain("app.get(['/student-journeys', '/student-journeys.html']");
    expect(source).toMatch(/res\.redirect\(301, '\/domains'\)/);
  });

  it('nothing still links to it', () => {
    const live = ['public/index.html', 'public/student-portal.html', 'public/academics.html',
                  'public/student-dashboard.html', 'public/student-portal/index.html'];
    live.forEach((f) => {
      expect(fs.readFileSync(path.join(root, f), 'utf8')).not.toContain('student-journeys');
    });
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

describe('the main website link', () => {
  const MAIN = 'https://www.entrepreneurshipnetwork.net/';

  it('has a prominent CTA band pointing at the main site', () => {
    const at = page.indexOf('class="eco-card"');
    expect(at).toBeGreaterThan(-1);
    const card = page.slice(at, at + 400);
    expect(card).toContain('href="' + MAIN + '"');
  });

  it('opens the external site in a new tab, safely', () => {
    const at = page.indexOf('class="eco-card"');
    const card = page.slice(at, at + 400);
    expect(card).toContain('target="_blank"');
    expect(card).toMatch(/rel="noopener noreferrer"/);
  });

  it('sits high on the page — after the hero, well before the footer', () => {
    const band = page.indexOf('class="eco-band');
    const works = page.indexOf('<section class="works"');
    const footer = page.indexOf('<footer');
    expect(band).toBeGreaterThan(-1);
    expect(band).toBeLessThan(works);   // first section on scroll
    expect(band).toBeLessThan(footer);
  });

  it('fades in on scroll like the rest of the page', () => {
    expect(page).toMatch(/class="eco-band reveal"/);
  });

  it('also links to the main site from the footer', () => {
    const foot = page.slice(page.indexOf('class="foot-links"'), page.indexOf('class="foot-links"') + 500);
    expect(foot).toContain('href="' + MAIN + '"');
    expect(foot).toContain('target="_blank"');
  });

  it('holds still for a reader who asked for less movement', () => {
    expect(page).toMatch(/@media \(prefers-reduced-motion:reduce\) \{ \.eco-card::before \{ animation:none/);
  });
});

/**
 * The opening curtain.
 *
 * It ran about 6.6 seconds — a 50-step countdown and then three seconds
 * holding on the finished word — and the counter at the bottom of the black
 * screen showed "50", which sat exactly where a timer sits and read as a
 * fifty-second wait. Nobody arrives at a landing page to watch a logo.
 *
 * These pin the shape of the fix rather than the taste of it: one duration
 * knob everything derives from, an honest counter, and the two things that
 * would silently break if the intro is ever shortened again.
 */
describe('opening curtain', () => {
  const countdownMs = Number(/const COUNTDOWN_MS = (\d+)/.exec(page)[1]);
  const holdMs = Number(/const HOLD_MS = (\d+)/.exec(page)[1]);

  it('has a knob for each half of the opening', () => {
    /*
     * One knob was right when both halves wanted the same thing — to be
     * short. They no longer do: the countdown is a deliberate wait with the
     * domain logos cycling through it, and the hold is a beat to see the
     * finished word. Deriving one from the other meant lengthening the wait
     * silently lengthened the beat too.
     */
    expect(countdownMs).toBeGreaterThan(0);
    expect(holdMs).toBeGreaterThan(0);
    expect(page).toContain('const COUNT_MS = COUNTDOWN_MS');
    expect(page).toContain('const FINALE_MS = HOLD_MS');
  });

  it('is over in five seconds, counting thirty at speed', () => {
    /*
     * Fifty seconds was a queue, ten was still a wait, and thirty seconds of
     * wall clock was worse than either — somebody arriving because they need
     * a resume in a hurry does not sit through half a minute of branding.
     *
     * The number is thirty and the clock is four and a half seconds: it falls
     * a third of a count every fiftieth of a second, which reads as something
     * loading at speed rather than as a countdown being endured.
     */
    expect(countdownMs).toBe(3600);   // 3600 + 1400 hold = 5s
    expect(Number(/const COUNT_FROM = (\d+)/.exec(page)[1])).toBe(30);
    /* Fast enough to be motion, slow enough that the digits are not a blur. */
    const tickMs = Number(/const COUNT_TICK_MS = (\d+)/.exec(page)[1]);
    expect(tickMs).toBeLessThanOrEqual(60);
    expect(tickMs).toBeGreaterThanOrEqual(30);
    /* The word still cracks into place and stays long enough to be read,
       rather than being glimpsed on the way out. */
    expect(holdMs).toBeGreaterThanOrEqual(1000);
    expect(holdMs).toBeLessThanOrEqual(2000);
  });

  it('lands the counter on zero exactly when the countdown ends', () => {
    /*
     * The step is derived rather than fixed at one, so the number reaches
     * zero as the countdown finishes however either constant is set. A
     * counter still reading 07 when the E lands is the seam this arithmetic
     * exists to prevent, and it is what happens the moment somebody changes
     * one number without the other.
     */
    expect(page).toMatch(/const TICK_MS = COUNT_TICK_MS/);
    expect(page).toMatch(/const STEP = COUNT_FROM \/ Math\.max\(1, Math\.round\(COUNT_MS \/ TICK_MS\)\)/);
    expect(page).toMatch(/n -= STEP;/);
    /* Zero-padded, so the width does not jump as it falls. */
    expect(page).toMatch(/padStart\(2, '0'\)/);

    const cd = Number(/const COUNTDOWN_MS = (\d+)/.exec(page)[1]);
    const from = Number(/const COUNT_FROM = (\d+)/.exec(page)[1]);
    const tick = Number(/const COUNT_TICK_MS = (\d+)/.exec(page)[1]);
    const ticks = Math.round(cd / tick);
    expect(Math.round(from - (from / ticks) * ticks)).toBe(0);
  });

  it('lands the E exactly when the impact fires', () => {
    // The fly-in is a CSS animation fixed at .8s, which is longer than the
    // finale now — left alone the flash would fire mid-flight.
    expect(page).toContain("slot.style.animationDuration = impactAt + 'ms'");
  });

  it('takes the shake off before lifting the curtain', () => {
    // pre-shake animates transform on #pre, and a running animation beats the
    // transition that slides the curtain away. At three seconds' distance it
    // had always finished on its own; at this speed it has not.
    const finale = page.slice(page.indexOf('function finale()'));
    const lift = finale.indexOf("pre.classList.add('done')");
    const unshake = finale.indexOf("pre.classList.remove('pre-shake')");
    expect(unshake).toBeGreaterThan(-1);
    expect(unshake).toBeLessThan(lift);
  });

  it('shows every one of the fourteen domains, not five of them', () => {
    /*
     * The swap hung off the countdown tick a fixed five times, so nine
     * domains were never shown at all — and across fifty seconds the five
     * that were looked like one frozen image with a number beside it. The
     * interval is divided out of the countdown, one slot per domain, so the
     * whole set gets its turn and stays correct if the timing changes again.
     */
    expect(page).toMatch(/const LOGO_MS = Math\.max\(120, Math\.round\(CYCLE_MS \/ DOMAIN_IMGS\.length\)\)/);
    expect(page).toMatch(/setInterval\([\s\S]{0,400}?\}, LOGO_MS\)/);

    /* Measured from the moment the letters finish separating, so the split
       cannot eat a domain's turn. */
    expect(page).toMatch(/const CYCLE_MS = Math\.max\(0, COUNT_MS - SPLIT_MS\)/);

    const imgs = /const DOMAIN_IMGS = \[([^\]]*)\]/.exec(page)[1].split(',').length;
    const splitMs = Number(/const SPLIT_MS = (\d+)/.exec(page)[1]);
    expect(imgs).toBe(14);
    /* Long enough to look at, short enough to still be a rotation. */
    /*
     * Fast enough to read as a flicker of domains rather than a slideshow,
     * and not so fast a logo is gone before the eye lands on it. At a four
     * and a half second countdown that is a shade over a quarter second each,
     * which is the speed the reference opens at.
     */
    const each = Math.round((countdownMs - splitMs) / imgs);
    expect(each).toBeGreaterThanOrEqual(150);
    expect(each).toBeLessThan(700);
  });

  it('starts with the letters touching, then opens the gap', () => {
    /*
     * T and N arrive as "TN" — a word with a letter missing rather than a
     * frame with a hole in it — and move apart on their own beat before
     * anything is put between them. Starting them apart made the first domain
     * appear out of nothing; starting them closed makes the same image look
     * like it was let in.
     *
     * Both the flex gap and the slot's width animate, because collapsing only
     * the slot leaves the letters a gutter apart and the split reads as a
     * nudge rather than as an opening.
     */
    expect(page).toMatch(/\.pre-word\.closed \{ gap:0; \}/);
    expect(page).toMatch(/\.pre-word\.closed #preSlot \{ width:0; opacity:0; \}/);
    expect(page).toMatch(/transition:gap var\(--split/);
    expect(page).toMatch(/word\.classList\.add\('closed'\)/);
    /* Two frames, so the closed state is painted before the class comes off —
       set in one frame there is nothing to transition from. */
    expect(page).toMatch(/requestAnimationFrame\(\(\) => requestAnimationFrame\(\(\) => word\.classList\.remove\('closed'\)\)\)/);
    /* And the domains wait for the gap to exist. */
    expect(page).toMatch(/\}, SPLIT_MS\);/);
  });

  it('finishes shaking before it lifts the curtain, with room to spare', () => {
    /*
     * The shake was fixed at .55s in the stylesheet. Against a short finale it
     * ran from 660ms to 1210ms while the curtain lifts at 1200 — ten
     * milliseconds of overlap, and an animation on transform beats the
     * transition doing the lifting. It survived only because removing the
     * class killed it mid-flight. Sized from the finale, it always ends first.
     */
    expect(page).toMatch(/const shakeMs = Math\.max\(120, Math\.round\(\(FINALE_MS - impactAt\) \* 0\.8\)\)/);
    expect(page).toMatch(/pre\.style\.animationDuration = shakeMs \+ 'ms'/);

    const impactAt = Math.round(holdMs * 0.55);
    const shakeMs = Math.max(120, Math.round((holdMs - impactAt) * 0.8));
    expect(impactAt + shakeMs).toBeLessThan(holdMs);
  });

  it('is three layers, not one sound at the impact', () => {
    /*
     * It began as four bells struck together at the impact — an event with no
     * approach, which is the shape of an alarm and sounded like one. Then a
     * rise into a landing, better but still starting only as the letter flew.
     *
     * Now it runs from the first frame: a bed almost inaudible under the
     * countdown, a DIFFERENT timbre as the letter starts moving, and the full
     * chord as it embeds.
     */
    const fn = page.slice(page.indexOf('function playIntroSting'));
    const body = fn.slice(0, fn.indexOf('\n  }'));

    // 1 — the bed: a fifth, detuned so it beats slowly instead of sitting still.
    expect(body).toMatch(/\[130\.81, 0\], \[130\.81, 7\], \[196\.00, 0\], \[196\.00, -6\]/);
    expect(body).toMatch(/peak \* 0\.06/);          // barely there at the start
    // 2 — the approach: a different wave, and it glides, so it reads as new.
    expect(body).toMatch(/voice\('triangle'/);
    expect(body).toMatch(/exponentialRampToValueAtTime\(392\.00, at \+ fly\)/);
    // 3 — the landing: the chord with a low octave under it.
    expect(body).toMatch(/\[130\.81, 0\.30/);
    expect(body).toMatch(/at \+ 0\.07/);             // real attack, not a click
    // The bed steps back so the chord has the room.
    expect(body).toMatch(/bedGains\.forEach/);

    expect(body).toMatch(/type = 'lowpass'/);
    expect(body).not.toContain('createBufferSource');   // no noise burst

    // Nothing recorded, nothing under the count from a file.
    expect(page).not.toContain("assets/intro/intro-ten.mp3");
    expect(page).not.toContain("assets/intro/intro-bed.mp3");
    expect(page).not.toMatch(/const BED_VOL/);
  });

  it('ducks the bed through its AudioParam, not the node', () => {
    /*
     * bedGains held GainNodes, and cancelScheduledValues lives on the param.
     * The TypeError was swallowed by the catch, so the bed and the approach
     * played and the landing chord silently never existed — audible as a
     * build-up that goes nowhere, which is very hard to read as a crash.
     */
    const fn = page.slice(page.indexOf('function playIntroSting'));
    const body = fn.slice(0, fn.indexOf('\n  }'));
    expect(body).toMatch(/bedGains\.push\(v\.gain\.gain\)/);
    expect(body).not.toMatch(/bedGains\.push\(v\.gain\)\s*;/);
    // And the swallow now says something, so the next one is not invisible.
    expect(body).toMatch(/console\.warn\('\[intro\] sound failed:'/);
  });

  it('schedules from the moment sound is allowed, not from a suspended clock', () => {
    /*
     * At the first frame the context is ALWAYS suspended — no browser allows
     * audio before the page has been interacted with. A suspended context's
     * clock does not advance, so scheduling then resuming later would play
     * the whole thing late and out of step with the picture.
     */
    const fn = page.slice(page.indexOf('function playIntroSting'));
    const body = fn.slice(0, fn.indexOf('\n  }'));
    expect(body).toMatch(/function schedule\(elapsed\)/);
    expect(body).toMatch(/schedule\(\(Date\.now\(\) - startedAt\) \/ 1000\)/);
    expect(body).toMatch(/Math\.max\(0, bed - elapsed\)/);
    // Only events that genuinely grant activation; a move or a scroll never does.
    const events = /const EVENTS = \[([^\]]+)\]/.exec(body)[1];
    ['pointerdown', 'keydown', 'touchend'].forEach((e) => expect(events).toContain(e));
    ['pointermove', 'wheel', 'scroll'].forEach((e) => expect(events).not.toContain(e));
    // And it gives up rather than firing a chord at some unrelated later moment.
    expect(body).toMatch(/if \(!scheduled\)/);
  });

  it('starts the soundtrack at the first frame, not in the finale', () => {
    // Layer one has to run underneath the countdown, so it cannot wait for
    // finale(). Both stage times come from the constants the animation uses.
    expect(page).toMatch(/playIntroSting\(COUNTDOWN_MS \/ 1000, \(HOLD_MS \* 0\.55\) \/ 1000\)/);
    const finale = page.slice(page.indexOf('function finale()'));
    expect(finale).not.toMatch(/playIntroSting\(/);
  });

  it('takes the shake off before lifting the curtain', () => {
    // pre-shake animates transform on #pre, and a running animation beats the
    // transition that slides the curtain away. At three seconds' distance it
    // had always finished on its own; at this speed it has not.
    const finale = page.slice(page.indexOf('function finale()'));
    const lift = finale.indexOf("pre.classList.add('done')");
    const unshake = finale.indexOf("pre.classList.remove('pre-shake')");
    expect(unshake).toBeGreaterThan(-1);
    expect(unshake).toBeLessThan(lift);
  });

  it('shows every one of the fourteen domains, not five of them', () => {
    /*
     * The swap hung off the countdown tick a fixed five times, so nine
     * domains were never shown at all — and across fifty seconds the five
     * that were looked like one frozen image with a number beside it. The
     * interval is divided out of the countdown, one slot per domain, so the
     * whole set gets its turn and stays correct if the timing changes again.
     */
    expect(page).toMatch(/const LOGO_MS = Math\.max\(120, Math\.round\(CYCLE_MS \/ DOMAIN_IMGS\.length\)\)/);
    expect(page).toMatch(/setInterval\([\s\S]{0,400}?\}, LOGO_MS\)/);

    /* Measured from the moment the letters finish separating, so the split
       cannot eat a domain's turn. */
    expect(page).toMatch(/const CYCLE_MS = Math\.max\(0, COUNT_MS - SPLIT_MS\)/);

    const imgs = /const DOMAIN_IMGS = \[([^\]]*)\]/.exec(page)[1].split(',').length;
    const splitMs = Number(/const SPLIT_MS = (\d+)/.exec(page)[1]);
    expect(imgs).toBe(14);
    /* Long enough to look at, short enough to still be a rotation. */
    /*
     * Fast enough to read as a flicker of domains rather than a slideshow,
     * and not so fast a logo is gone before the eye lands on it. At a four
     * and a half second countdown that is a shade over a quarter second each,
     * which is the speed the reference opens at.
     */
    const each = Math.round((countdownMs - splitMs) / imgs);
    expect(each).toBeGreaterThanOrEqual(150);
    expect(each).toBeLessThan(700);
  });

  it('starts with the letters touching, then opens the gap', () => {
    /*
     * T and N arrive as "TN" — a word with a letter missing rather than a
     * frame with a hole in it — and move apart on their own beat before
     * anything is put between them. Starting them apart made the first domain
     * appear out of nothing; starting them closed makes the same image look
     * like it was let in.
     *
     * Both the flex gap and the slot's width animate, because collapsing only
     * the slot leaves the letters a gutter apart and the split reads as a
     * nudge rather than as an opening.
     */
    expect(page).toMatch(/\.pre-word\.closed \{ gap:0; \}/);
    expect(page).toMatch(/\.pre-word\.closed #preSlot \{ width:0; opacity:0; \}/);
    expect(page).toMatch(/transition:gap var\(--split/);
    expect(page).toMatch(/word\.classList\.add\('closed'\)/);
    /* Two frames, so the closed state is painted before the class comes off —
       set in one frame there is nothing to transition from. */
    expect(page).toMatch(/requestAnimationFrame\(\(\) => requestAnimationFrame\(\(\) => word\.classList\.remove\('closed'\)\)\)/);
    /* And the domains wait for the gap to exist. */
    expect(page).toMatch(/\}, SPLIT_MS\);/);
  });

  it('finishes shaking before it lifts the curtain, with room to spare', () => {
    /*
     * The shake was fixed at .55s in the stylesheet. Against a short finale it
     * ran from 660ms to 1210ms while the curtain lifts at 1200 — ten
     * milliseconds of overlap, and an animation on transform beats the
     * transition doing the lifting. It survived only because removing the
     * class killed it mid-flight. Sized from the finale, it always ends first.
     */
    expect(page).toMatch(/const shakeMs = Math\.max\(120, Math\.round\(\(FINALE_MS - impactAt\) \* 0\.8\)\)/);
    expect(page).toMatch(/pre\.style\.animationDuration = shakeMs \+ 'ms'/);

    const impactAt = Math.round(holdMs * 0.55);
    const shakeMs = Math.max(120, Math.round((holdMs - impactAt) * 0.8));
    expect(impactAt + shakeMs).toBeLessThan(holdMs);
  });

  it('never breaks the page when audio is blocked', () => {
    /*
     * Browsers refuse audio until the page has been interacted with, and
     * typing a URL is not an interaction. On a cold load the chime is silent
     * by design — a flourish, not a feature — and a blocked context must not
     * throw. This is why it checks the state and wraps the whole thing.
     */
    const fn = page.slice(page.indexOf('function playIntroSting'));
    const body = fn.slice(0, fn.indexOf('\n  }'));
    // It no longer gives up on a suspended context — it waits for a gesture —
    // but it must still only schedule once sound is actually allowed.
    expect(body).toContain("ctx.state !== 'running'");
    expect(body).toContain('try {');
    expect(body).toMatch(/catch \(e\)/);
    expect(body).toContain("matchMedia('(prefers-reduced-motion: reduce)').matches");
  });

  it('has no sound control anywhere on the page', () => {
    /*
     * Two sounds both asking to be switched on is a page arguing with itself.
     * The intro carries the only sound, and it needs no control — nothing to
     * find, nothing to press, nothing to decide.
     */
    expect(page).not.toMatch(/id="preSound"/);
    expect(page).not.toMatch(/id="soundBtn"/);
    expect(page).not.toMatch(/SOUND_KEY/);
    expect(page).not.toMatch(/AMBIENT_URL/);
    expect(page).not.toMatch(/playBed/);
  });

  it('stops cycling logos when the countdown ends', () => {
    /* Both clocks stop together — a swap still queued would drop a domain
       back on top of the E that has just landed. */
    expect(page).toMatch(/clearInterval\(tick\);[\s\S]{0,80}clearInterval\(cycle\)/);
  });
});
