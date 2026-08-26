'use strict';

const fs = require('fs');
const path = require('path');
const read = (p) => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8');
const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const GALAXY = read('student-portal-app/src/components/GalaxyCanvas.tsx');
const GALAXY_CODE = strip(GALAXY);
const ECO = read('student-portal-app/src/components/EcosystemSection.tsx');
const ECO_CODE = strip(ECO);
const APP = read('student-portal-app/src/App.tsx');
const HERO = read('student-portal-app/src/components/HeroSection.tsx');
const ROUTE = strip(read('routes/v2/studio.js'));
const PKG = JSON.parse(read('student-portal-app/package.json'));

describe('the WebGL galaxy can only ever add to the page', () => {
  it('uses real Three.js, which is what was chosen', () => {
    expect(PKG.dependencies.three).toBeTruthy();
    expect(GALAXY_CODE).toContain("import('three')");
  });

  /*
   * A static import would put 700KB of WebGL in front of the first paint of a
   * marketing page. The dynamic import runs after mount, so the page is
   * readable before a byte of it arrives — and the devices below never fetch
   * it at all.
   */
  it('loads it lazily, never in the page bundle', () => {
    expect(GALAXY_CODE).not.toMatch(/^import .*from 'three'/m);
    const bundleDir = path.join(__dirname, '../../public/student-portal/assets');
    const files = fs.readdirSync(bundleDir);
    expect(files.some((f) => /^three/.test(f))).toBe(true);       // its own chunk
    const page = files.find((f) => /^index-.*\.js$/.test(f));
    expect(fs.statSync(path.join(bundleDir, page)).size).toBeLessThan(400 * 1024);
  });

  it('stays away from devices that asked it to', () => {
    expect(GALAXY_CODE).toContain("matchMedia('(prefers-reduced-motion: reduce)').matches) return;");
    expect(GALAXY_CODE).toContain('if (conn && conn.saveData) return;');
    expect(GALAXY_CODE).toMatch(/getContext\('webgl2'\).*getContext\('webgl'\)\) return;/);
  });

  it('does not warm a phone in the hand', () => {
    expect(GALAXY_CODE).toContain('Math.min(window.devicePixelRatio, 2)');
    expect(GALAXY_CODE).toMatch(/phone \? 3200 : 7000/);
    // and stops burning frames the moment nobody can see it
    expect(GALAXY_CODE).toContain('document.hidden ? stop() : start()');
    expect(GALAXY_CODE).toContain('entry.isIntersecting ? start() : stop()');
  });

  it('cleans up after itself instead of leaking a renderer per visit', () => {
    ['geo.dispose()', 'mat.dispose()', 'renderer.dispose()', 'renderer.domElement.remove()']
      .forEach((call) => expect(GALAXY_CODE).toContain(call));
  });

  it('is decoration, and says so to a screen reader', () => {
    expect(GALAXY).toContain('aria-hidden="true"');
    expect(GALAXY).toContain('pointer-events-none');
    expect(HERO).toContain('<GalaxyCanvas />');
  });
});

describe('the four doors are joined up on the page that sells them', () => {
  it('is on the page, right after the opening', () => {
    expect(APP).toContain('<EcosystemSection />');
  });

  /*
   * The ring is CSS preserve-3d rather than WebGL on purpose: these are links
   * that must stay clickable, focusable and readable by a screen reader, which
   * DOM gives for free and textured quads never will.
   */
  it('keeps the doors as real links, not textured quads', () => {
    expect(ECO).toContain("transformStyle: 'preserve-3d'");
    expect(ECO).toMatch(/<a\s+href=\{door\.href\}/);
    ['course', 'resume', 'job', 'hackathon'].forEach((k) =>
      expect(ECO).toContain(`key: '${k}'`));
  });

  it('routes every paid door through the pay screen, never straight in', () => {
    expect(ECO).toContain("href: '/studio.html?want=course'");
    expect(ECO).toContain("href: '/studio.html?want=resume'");
    expect(ECO).toContain("href: '/studio.html?want=job'");
    // the hackathon takes its fee at registration, inside its own portal
    expect(ECO).toContain("href: '/hackathon-portal/'");
    expect(ECO).not.toContain("href: '/job-portal");
    expect(ECO).not.toContain("href: '/resume-portal");
  });

  /*
   * The figures on screen are an echo of config/studioPricing.js, fetched from
   * a public endpoint — the page carrying its own copy of the numbers is how
   * two screens end up quoting two prices. The fallback exists because a
   * static page must render without a server, and it must match the config.
   */
  it('echoes the one price list instead of owning a second', () => {
    expect(ECO_CODE).toContain("fetch('/api/v2/studio/pricing')");
    expect(ROUTE).toContain("router.get('/pricing', (req, res)");
    expect(ROUTE).toContain('studioPricing.getPricingTable()');

    const pricing = require('../../config/studioPricing');
    const t = pricing.getPricingTable();
    expect(ECO).toContain(`price: '₹${t.singles.find((s) => s.key === 'course').price}'`);
    expect(ECO).toContain(`price: '₹${t.singles.find((s) => s.key === 'resume').price}'`);
    expect(ECO).toContain(`price: '₹${t.singles.find((s) => s.key === 'job').price}'`);
    expect(ECO).toContain(`COMBO_FALLBACK = { price: ${t.combo.price}, insteadOf: ${t.combo.insteadOf}, saving: ${t.combo.saving} }`);
  });

  it('turns by itself until it is touched, then it is theirs', () => {
    expect(ECO_CODE).toContain('if (flat || still) return;');
    expect(ECO_CODE).toContain('setStill(true)');
  });

  // Jumping three doors clockwise when one anticlockwise would do reads as a
  // spin cycle, not a choice.
  it('turns the short way round to a chosen door', () => {
    expect(ECO_CODE).toContain('const shortestTurn = (from, i) =>'.replace('(from, i)', '(from: number, i: number)'));
    expect(ECO_CODE).toContain('if (diff > 180) diff -= 360;');
  });

  it('stands still as a flat grid for anyone who asked for less motion', () => {
    expect(ECO_CODE).toContain("window.matchMedia('(prefers-reduced-motion: reduce)').matches");
    expect(ECO).toMatch(/flat \? \(/);
  });

  it('sells the combo with the saving the config actually gives', () => {
    expect(ECO).toContain('save ₹{combo.saving}');
    expect(ECO).toContain('href="/studio.html"');
  });
});
