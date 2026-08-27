'use strict';

const fs = require('fs');
const path = require('path');
const read = (p) => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8');
const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const GALAXY = read('student-portal-app/src/components/GalaxyCanvas.tsx');
const GALAXY_CODE = strip(GALAXY);
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

describe('the hub page persuades; the overview page explains', () => {
  const APP2 = read('student-portal-app/src/App.tsx');
  const BEN = read('student-portal-app/src/components/BenefitsSection.tsx');
  const HERO2 = read('student-portal-app/src/components/HeroSection.tsx');
  const FACE = read('student-portal-app/src/components/StudentFaceSection.tsx');
  const FEAT = read('student-portal-app/src/components/FeaturesSection.tsx');
  const OVW = read('public/overview.html');
  const path2 = require('path');

  it('the four-doors ring is gone, benefits and voices replace it', () => {
    expect(fs.existsSync(path2.join(__dirname, '../../student-portal-app/src/components/EcosystemSection.tsx'))).toBe(false);
    expect(APP2).toContain('<BenefitsSection />');
    expect(BEN).toMatch(/What you get/);
    expect(BEN).toMatch(/Students, after/);
    // six voices, first-name + domain only — nothing impersonates a real person
    expect((BEN.match(/blockquote/g) || []).length).toBeGreaterThanOrEqual(2);
    expect(BEN).toContain('replace with real ones');
  });

  it('the email box is the sign-up, for the academic portal', () => {
    expect(HERO2).toContain('Enter your email to sign up');
    expect(HERO2).toContain('sign-up for the TEN Academic Portal');
    /*
     * And nothing beside it. The overview is what the mail links to — a button
     * offering it here let people take the tour without ever signing up, which
     * is the one thing this section exists to collect.
     */
    expect(HERO2).not.toContain('href="/overview"');
    expect(HERO2).not.toContain('href="/domains"');
  });

  /*
   * Every "start" is the email box now. A button that led away to /domains
   * skipped the sign-up this page exists to collect.
   */
  it('every start-your-journey leads to the sign-up box', () => {
    expect(FEAT).toContain('onClick={goToSignup}');
    expect(read('student-portal-app/src/signup.ts')).toContain("getElementById('hero')");
    // comment-stripped: the words may live on in the comment explaining the
    // removal, never in rendered JSX
    expect(strip(FACE)).not.toContain('Start your journey');
  });

  it('the overview page walks all six engines and ends at the registration', () => {
    ['01 · LEARN', '02 · INTERN', '03 · BE GUIDED', '04 · BE READY', '05 · GET HIRED', '06 · COMPETE']
      .forEach((k) => expect(OVW).toContain(k));
    expect(OVW).toMatch(/Mentorship, on call/);
    expect(OVW).toContain('href="/domains"');
    expect(OVW).toContain('/student-login.html?next=%2Fstudio.html');
    // the 3D backdrop is real projection math, not a static image
    expect(OVW).toContain('(x1 / z2) * scale');
    expect(OVW).toContain('prefers-reduced-motion');
  });

  it('the mail, the overview and the domains page form one path', () => {
    const lead = read('services/studioLead.js');
    expect(lead).toContain("+ '/overview'");
    const domains = read('public/domains.html');
    expect(domains).toContain('"/academic-register"');
    expect(read('server.js')).toContain("app.get('/overview'");
    expect(read('server.js')).toContain("app.get('/academic-register'");
  });

  it('the registration asks the fork question first', () => {
    const reg = read('public/academic-register.html');
    expect(reg).toContain('Are you already registered in the TEN portal');
    expect(reg).toContain('/student-login.html?next=%2Fstudio.html');
    expect(reg).toContain("api('/api/v2/learn/signup'");
    // pay-after is offered for the course alone; the combo is pay-now only
    expect(reg).toContain('data-mode="after"');
    expect(reg).not.toMatch(/value="combo"[^>]*data-mode="after"/);
  });

  it('an existing account sees their details before the upgrade', () => {
    expect(read('routes/v2/studio.js')).toContain('student: { name: student.name');
    expect(read('public/studio.html')).toContain('function whoHtml(d)');
  });

  /*
   * The same person holds two ids: their Student row (used when they bought as
   * an intern) and their EcosystemUser row (used when they sign into /learn).
   * Access must match by email across them, or a paid upgrade opens nothing.
   */
  it('an intern who upgraded can open the academic portal', () => {
    const learn = strip(read('routes/v2/learn.js'));
    expect(learn).toContain('async function courseAccessFor(who)');
    // The matching lives in the access service, so the middleware in front of
    // the Resume and Job portals answers it exactly the same way.
    expect(learn).toContain("studioAccess.getStudioAccessForEither(accessSubject(who), 'course')");
    const svc = strip(read('services/studioAccess.js'));
    expect(svc).toMatch(/Student\.findOne\(\{ email \}\)/);
    expect(strip(read('middleware/studioGate.js'))).toContain('req.session.learner');
  });

  it('approval sends the promised mail, naming what was added', () => {
    const admin = read('routes/adminPortal.js');
    expect(admin).toContain('if (isStudio && payment.customerEmail)');
    expect(admin).toContain('It is in your portal');
    // Each unlocked section, with the link that opens it.
    expect(admin).toContain("course: ['The Academic Portal");
    expect(admin).toContain("'/resume-portal/'");
    expect(admin).toContain("'/job-portal/'");
    // A learner has no Student row; refusing those made their payments
    // impossible to approve at all.
    expect(admin).toContain('if (!student && !isStudio)');
  });

  /*
   * A paid internship track includes all three. Until now nothing inside the
   * intern's own portal said so, so students who owned everything were being
   * sent to a pricing page to buy it again.
   */
  it('shows a student the sections they already have, in their own portal', () => {
    const dash = read('public/student-dashboard.html');
    expect(dash).toContain("fetch('/api/v2/studio/status'");
    expect(dash).toContain("href: '/learn'");
    expect(dash).toContain("href: '/resume-portal/'");
    expect(dash).toContain("href: '/job-portal/'");
    expect(dash).toContain('included with your internship');
    // A request still with HR is visible too, or it reads as never sent.
    expect(dash).toContain('Waiting on HR');
  });

  it('a learner session can buy through the studio routes', () => {
    const studio = strip(read('routes/v2/studio.js'));
    expect(studio).toContain('req.session.learner');
    expect(studio).toContain('isLearner: true');
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

  // The email box is the sign-up and the overview is the path to domains, so
  // the bar keeps only what does not shortcut that: Features, About, Login.
  it('has dropped Sign Up, STUDENT and Domains too', () => {
    const nav = strip(NAV);
    expect(nav).not.toContain('/register.html');
    expect(nav).not.toContain('>Sign Up<');
    expect(nav).not.toContain('STUDENT');
    expect(nav).not.toContain("route: 'pricing'");
    expect(nav).toContain('/student-login.html');
  });
});

describe('the account question moved to the registration page', () => {
  // The popup asked it a page early, then /academic-register asked it again.
  it('the popup is gone from the hub', () => {
    const path2 = require('path');
    expect(fs.existsSync(path2.join(__dirname,
      '../../student-portal-app/src/components/AccountGate.tsx'))).toBe(false);
    expect(read('student-portal-app/src/App.tsx')).not.toContain('<AccountGate />');
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
