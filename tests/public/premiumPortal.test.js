'use strict';

const fs = require('fs');
const path = require('path');

const read = (p) => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8');
/** Assertions run against a comment-stripped copy: a sentence in a comment
 *  must never be what satisfies a test about the code. */
const stripComments = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '')
  .replace(/<!--[\s\S]*?-->/g, '');

const SERVER = read('server.js');
const SERVER_CODE = stripComments(SERVER);
const THEME = read('public/css/premium-theme.css');
const CHROME = read('public/js/premium-chrome.js');
const DASH = read('public/student-dashboard.html');
const CERTS = read('public/my-certificates.html');
const CERT_ROUTE = stripComments(read('routes/v2/certificates.js'));

describe('the activity mail lands at most once a week', () => {
  it('still runs on the weekly schedule', () => {
    expect(SERVER_CODE).toContain("cron.schedule('0 9 * * 1', runActivityMailer)");
  });

  /*
   * The schedule was never the problem. `Student.find()` returns ROWS, and a
   * student holding two domains has two under the same address — two mails
   * every Monday. A second process pointed at the same database mails everyone
   * again on top of that. The cadence is decided by this lookup, not the cron.
   */
  it('counts per address, so two domain rows are one person', () => {
    expect(SERVER_CODE).toContain('async function recentActivityMailRecipients()');
    expect(SERVER_CODE).toMatch(/studentEmail.*trim\(\)\.toLowerCase\(\)/);
    expect(SERVER_CODE).toContain('if (alreadyMailed.has(key)) { skipped++; continue; }');
  });

  it('reads the window from what was actually sent, not from process memory', () => {
    // Process memory is per-process, and the duplicate sends came from a
    // SECOND process. Only the shared log can settle it.
    expect(SERVER_CODE).toMatch(/AutoMailLog\.find\(\{[\s\S]{0,200}sentAt: \{ \$gte: since \}/);
  });

  it('claims the address before the send, not after', () => {
    // The second row for this student is in the same loop, and one await is
    // all the room it needs to slip through.
    const loop = SERVER_CODE.slice(SERVER_CODE.indexOf('alreadyMailed.add(key)'));
    expect(loop.slice(0, 120)).toContain('await sendActivityMail');
  });

  it('caps at six days, so a weekly run can never double up', () => {
    expect(SERVER_CODE).toContain('const ACTIVITY_MAIL_COOLDOWN_DAYS = 6;');
  });

  it('sends nothing at all if it cannot read the cooldown', () => {
    // Sending because the guard broke is the complaint itself.
    expect(SERVER_CODE).toMatch(/cooldown lookup failed, skipping this run[\s\S]{0,60}return;/);
  });
});

describe('the paid portal is the whole portal', () => {
  const STUDENT_PAGES = [
    'public/student-dashboard.html', 'public/my-certificates.html',
    'public/my-documents.html', 'public/v2-tasks.html',
    'public/academics.html', 'public/assistant.html'
  ];

  it.each(STUDENT_PAGES)('%s wears the premium theme', (page) => {
    const html = read(page);
    expect(html).toContain('<link rel="stylesheet" href="/css/premium-theme.css">');
    expect(html).toContain('<script src="/js/premium-chrome.js" defer></script>');
  });

  /*
   * The re-skin is variable overrides, not a selector fight. The student pages
   * draw themselves from custom properties in two different naming families,
   * so both are redefined and one file re-skins every page.
   */
  it('re-skins by redefining both variable families', () => {
    expect(THEME).toMatch(/body\.is-premium \{[\s\S]*--bg-base:/);
    expect(THEME).toMatch(/body\.is-premium \{[\s\S]*--bg:\s*#/);
    expect(THEME).toMatch(/--text-primary:\s*#F6EFDD/);
    expect(THEME).toMatch(/--border:\s*rgba\(212, 175, 55/);
  });

  it('leaves a free-track portal exactly as it was', () => {
    // Every rule scoped to the class. An unscoped rule would re-skin everyone.
    const rules = THEME.split('}').map((r) => r.split('{')[0].trim()).filter(Boolean);
    const unscoped = rules.filter((sel) =>
      !/is-premium|premium-mark|premium-badges|^@|^\s*$|^\/\*/.test(sel) && !sel.startsWith('.pm-') && !sel.startsWith('.pb'));
    expect(unscoped).toEqual([]);
  });

  it('is decided by the server, never by the browser', () => {
    expect(CHROME).toContain("fetch('/api/v2/premium/me'");
    // A student whose track lapsed must lose the chrome, not keep it.
    expect(CHROME).toMatch(/else unapply\(\);/);
    expect(CHROME).toMatch(/function unapply\(\)[\s\S]{0,160}classList\.remove\('is-premium'\)/);
  });
});

describe('there is no premium section any more', () => {
  it('the separate gold panel is gone from the dashboard', () => {
    expect(DASH).not.toContain('id="premiumPanel"');
    expect(DASH).not.toContain("getElementById('pp_plan')");
    expect(DASH).not.toContain("getElementById('pp_badges')");
  });

  // Removing the box must not remove what was in it.
  it('but its badges, projects and notes still reach the student', () => {
    expect(DASH).toContain('id="premiumWork"');
    expect(DASH).toContain('premiumProjectHtml');
    expect(DASH).toMatch(/Projects from your coordinator/);
    expect(DASH).toMatch(/Notes from your coordinator/);
    expect(DASH).toMatch(/class="premium-badges"/);
  });

  it('and the plan sits beside the student’s name instead', () => {
    expect(CHROME).toMatch(/getElementById\('welcomeText'\)/);
    expect(CHROME).toContain("mark.className = 'premium-mark'");
    expect(THEME).toContain('.premium-mark {');
  });

  it('shows nothing at all when there is nothing assigned', () => {
    // An empty "your coordinator will post here" box is the locked-box pattern
    // this change exists to remove.
    expect(DASH).toContain("host.style.display = html ? '' : 'none';");
  });
});

describe('a certificate the paid track already covers', () => {
  /*
   * Two questions the screen used to answer with one word:
   *   paid      is the fee settled
   *   unlocked  has the student earned it
   * A paid track settles the fee long before the student is eligible.
   */
  it('separates the fee from the eligibility', () => {
    expect(CERTS).toMatch(/const paid\s+= certInfo\?\.feeSettled\?\.covered/);
    expect(CERTS).toContain('const unlocked = certInfo?.unlocked;');
  });

  it('says which plan covered it rather than quoting a price', () => {
    expect(CERTS).toContain('Included in your ${planName} plan');
    expect(CERTS).toContain("${paid ? '' : ` — ₹${price}`}");
  });

  it('is reserved, not locked, while the student is still working towards it', () => {
    expect(CERTS).toContain('🔓 Reserved for you — ${need}');
    expect(CERTS).toContain('🔒 Locked — ${need}');
  });

  it('still requires the eligibility bar to be cleared', () => {
    // The whole point: covered does not mean issued.
    const btn = CERTS.slice(CERTS.indexOf('let actionBtn'), CERTS.indexOf('let barPct'));
    expect(btn).toMatch(/if \(!unlocked\) \{/);
    expect(btn).toMatch(/Top 10% ranking needed/);
    expect(btn).toMatch(/completion needed/);
  });

  it('asks for no money once the fee is settled', () => {
    expect(CERTS).toContain('🎉 Claim It — already paid');
  });
});

describe('the claim route honours every way the fee can be settled', () => {
  /*
   * It used to check the coin redemption only, so the waiver a paid track
   * writes was never read and a student sold a "Fellowship fee included" was
   * still sent to Razorpay for the full ₹2,500.
   */
  it('asks the one module rather than one store', () => {
    expect(CERT_ROUTE).toMatch(/const settled = await require\("\.\.\/\.\.\/services\/certificateEntitlement"\)\.feeSettled\(student, type\)/);
    expect(CERT_ROUTE).toContain('if (settled.covered) {');
  });

  it('no longer decides on the coin redemption alone', () => {
    expect(CERT_ROUTE).not.toMatch(/if \(redemption\) \{\s*return res\.json\(/);
  });

  it('refuses a certificate the student has not earned, paid or not', () => {
    const claim = CERT_ROUTE.slice(CERT_ROUTE.indexOf('/certificates/claim/:type'));
    const gate = claim.indexOf('You have not yet unlocked this certificate');
    const fee  = claim.indexOf('settled.covered');
    expect(gate).toBeGreaterThan(-1);
    expect(fee).toBeGreaterThan(gate);   // eligibility is checked FIRST
  });

  it('tells the screen which fees are settled', () => {
    expect(CERT_ROUTE).toContain('payload.feeSettled = await require("../../services/certificateEntitlement").feeSettledAll(student)');
    expect(CERT_ROUTE).toContain('payload.planName');
  });
});
