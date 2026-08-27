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

describe('the navbar sends nobody at a locked door', () => {
  const NAV = read('student-portal-app/src/components/Navbar.tsx');

  /*
   * JOB, RESUME and HACK sat in the navbar as links straight into the portals.
   * Since middleware/studioGate.js started turning those URLs away, each pill
   * was a door into a bounce. The four products are reached from the ecosystem
   * ring, which routes through the pay screen the way it is meant to.
   */
  it('has dropped the pills that pointed into the gated portals', () => {
    expect(NAV).not.toContain('/job-portal/');
    expect(NAV).not.toContain('/resume-portal/');
    expect(NAV).not.toContain('/hackathon-portal/');
  });

  it('keeps STUDENT, which is the portal you are standing in', () => {
    expect(NAV).toContain('STUDENT');
  });
});

describe('the first question the Studio asks', () => {
  const GATE = read('student-portal-app/src/components/AccountGate.tsx');
  const GATE_CODE = strip(GATE);

  it('is on the page', () => {
    expect(APP).toContain('<AccountGate />');
  });

  /*
   * The two answers lead to different products, and getting it wrong costs
   * real time: a returning student sent through registration makes a second
   * account, a newcomer sent to the pay screen is asked for money before
   * picking a domain.
   */
  it('sends an existing account to pay, and a newcomer to pick a domain', () => {
    expect(GATE).toContain('href="/studio.html"');
    expect(GATE).toContain('href="/domains"');
  });

  // They answered it by being signed in; asking anyway is how a product feels
  // stupid. 401 from the status route is the signed-out signal.
  it('is never asked of somebody already signed in', () => {
    expect(GATE_CODE).toContain("fetch('/api/v2/studio/status'");
    expect(GATE_CODE).toContain('if (cancelled || r.ok) return;');
  });

  it('is asked once per browser, not on every visit', () => {
    expect(GATE_CODE).toContain("const ASKED_KEY = 'ten-studio-asked';");
    expect(GATE_CODE).toContain('if (localStorage.getItem(ASKED_KEY)) return;');
    // and answering counts as having been asked
    expect(GATE).toContain('onClick={remember}');
  });

  it('is never a trap', () => {
    expect(GATE_CODE).toContain("if (e.key === 'Escape') dismiss();");
    expect(GATE_CODE).toContain('if (e.target === e.currentTarget) dismiss();');
    expect(GATE).toContain("I&apos;m just looking");
  });

  it('announces itself as a dialog and takes focus', () => {
    expect(GATE).toContain('role="dialog"');
    expect(GATE).toContain('aria-modal="true"');
    expect(GATE).toContain('aria-labelledby="account-gate-title"');
    expect(GATE_CODE).toContain('first.current?.focus();');
  });

  // A private window throws on localStorage; the question is worth more than
  // the memory of having asked it.
  it('still asks when the browser will not remember', () => {
    expect(GATE_CODE).toMatch(/try \{[\s\S]{0,120}localStorage\.getItem\(ASKED_KEY\)[\s\S]{0,60}\} catch/);
    expect(GATE_CODE).toMatch(/\.catch\(\(\) => \{[\s\S]{0,200}setOpen\(true\)/);
  });
});

describe('the smaller fixes', () => {
  const DOMAINS = read('public/domains.html');
  const MSG = read('public/messages.html');
  const HACK = read('hackathon-portal-app/src/App.tsx');

  it('the domains page has no notification orb', () => {
    expect(DOMAINS).not.toContain('notify-orb.js');
  });

  /*
   * "← TEN" always went to the marketing home page, throwing out anybody who
   * arrived from inside the product. The referrer decides now, and only when
   * it is same-site — a search result or pasted link still gets the home page.
   */
  it('the domains back link returns where the visitor came from', () => {
    expect(DOMAINS).toContain('id="backLink"');
    expect(DOMAINS).toContain('new URL(ref).origin === location.origin');
  });

  /*
   * Every arriving message triggered a full /threads fetch, and dm_notice
   * fired a second for the same message — one or two HTTP round-trips PER
   * MESSAGE to re-download a list that changed by one line.
   */
  it('messages updates the inbox in place instead of refetching it', () => {
    expect(MSG).toContain('function bumpThread(m, unread)');
    const handler = MSG.slice(MSG.indexOf('socket.on("receive_message"'), MSG.indexOf('socket.on("typing"'));
    expect(handler).not.toContain('loadThreads()');
    expect(handler).toContain('bumpThread(');
  });

  it('collapses a burst of notices into one request', () => {
    expect(MSG).toContain('function refreshThreads()');
    expect(MSG).toContain('if (refreshTimer) return;');
  });

  // A socket that dropped may have missed messages; that is the one moment a
  // real fetch earns itself.
  it('catches up after a reconnect, and rejoins the open room', () => {
    const conn = MSG.slice(MSG.indexOf('socket.on("connect"'), MSG.indexOf('socket.on("disconnect"'));
    expect(conn).toContain('refreshThreads();');
    expect(conn).toContain('join_room');
  });

  it('offers a next step on an empty inbox instead of only reporting emptiness', () => {
    expect(MSG).toContain('Start a conversation');
    expect(MSG).toContain('onclick="openPicker()"');
    expect(MSG).toContain('function openPicker()');
  });

  it('the hackathon page explains how to take part', () => {
    expect(HACK).toContain('function HowItWorks()');
    expect(HACK).toContain('<HowItWorks />');
    expect(HACK).toContain("'Six steps, start to certificate'".replace(/'/g, ''));
    expect(HACK).toContain('WHAT YOU NEED');
  });

  it('the hackathon nav no longer links into the gated portals', () => {
    const nav = HACK.slice(HACK.indexOf('const NAV = ['), HACK.indexOf('];', HACK.indexOf('const NAV = [')));
    expect(nav).not.toContain('/job-portal/');
    expect(nav).not.toContain('/resume-portal/');
    expect(nav).toContain("href: '#how'");
  });
});
