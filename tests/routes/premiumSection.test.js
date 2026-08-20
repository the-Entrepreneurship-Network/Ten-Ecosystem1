'use strict';

/**
 * @jest-environment node
 *
 * The premium section: who may see it, who may write into it, and what a
 * free-track student is shown instead.
 *
 * The rule that matters most is the negative one — a free-track student must
 * never be told they can buy something they cannot — so most of these tests are
 * about what does NOT happen. No MongoDB in the sandbox, so status logic runs
 * directly and wiring is asserted on source, as elsewhere in this suite.
 */

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '../..');
const { getPremiumStatus, isPremium } = require('../../utils/premium');

const premiumRoutes = fs.readFileSync(path.join(root, 'routes/v2/premium.js'), 'utf8');
const serverJs      = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const dashboard     = fs.readFileSync(path.join(root, 'public/student-dashboard.html'), 'utf8');
const coordPage     = fs.readFileSync(path.join(root, 'public/coordinator-dashboard.html'), 'utf8');
const benefitsSvc   = fs.readFileSync(path.join(root, 'services/tenureBenefits.js'), 'utf8');

const paidUnpaid  = { tenure: '1 Month', createdAt: new Date() };
const paidSettled = { tenure: '1 Month', createdAt: new Date(), shortCoursePaid: true };
const bundled     = { tenure: '15 Days', createdAt: new Date(), tenureBenefits: { grantedAt: new Date(), plan: 'Accelerate' } };
const freeTrack   = { tenure: '6 Months', createdAt: new Date() };

describe('who is premium', () => {
  it('a settled paid track is premium; an unpaid one is not', () => {
    expect(isPremium(paidSettled)).toBe(true);
    expect(isPremium(bundled)).toBe(true);
    expect(isPremium(paidUnpaid)).toBe(false);
  });

  it('a free track is never premium, and is never told it is on a paid track', () => {
    const s = getPremiumStatus(freeTrack);
    expect(s.premium).toBe(false);
    expect(s.onPaidTrack).toBe(false);   // drives "you cannot buy this" copy
    expect(s.reason).toBe('free track');
  });

  it('an unpaid paid-track student is the one who gets the upsell', () => {
    const s = getPremiumStatus(paidUnpaid);
    expect(s.premium).toBe(false);
    expect(s.onPaidTrack).toBe(true);
  });

  it('students who predate the fee are not locked out of what they never owed', () => {
    expect(isPremium({ tenure: '1 Week', isExistingStudent: true })).toBe(true);
  });

  it('the plan name is carried through for the badge', () => {
    expect(getPremiumStatus(bundled).plan).toBe('Accelerate');
    expect(getPremiumStatus(paidSettled).plan).toBe('Starter');
  });

  it('nothing at all is premium without a student', () => {
    [null, undefined, {}].forEach((s) => expect(isPremium(s)).toBe(false));
  });
});

describe('the guard', () => {
  it('answers 402, not 403 — there is a price on this, it is not forbidden', () => {
    const util = fs.readFileSync(path.join(root, 'utils/premium.js'), 'utf8');
    expect(util).toMatch(/res\.status\(402\)/);
    expect(util).toMatch(/premiumRequired: true/);
    expect(util).not.toMatch(/res\.status\(403\)/);
  });

  it('fails closed when the status cannot be determined', () => {
    const util = fs.readFileSync(path.join(root, 'utils/premium.js'), 'utf8');
    expect(util).toMatch(/res\.status\(503\)/);
  });

  it('takes identity from the session, never from the request body', () => {
    const util = fs.readFileSync(path.join(root, 'utils/premium.js'), 'utf8');
    expect(util).toMatch(/req\.session && req\.session\.student/);
    expect(util).not.toMatch(/req\.body/);
  });
});

describe('the AI assistant belongs to the paid tracks', () => {
  it('the API is gated', () => {
    expect(serverJs).toMatch(/app\.use\('\/api\/v2\/assistant', requirePremium, v2Assistant\)/);
  });

  it('the page redirects instead of loading and then failing every call', () => {
    const block = serverJs.slice(serverJs.indexOf("app.get('/assistant'"), serverJs.indexOf("const v2Academics"));
    expect(block).toMatch(/res\.redirect\('\/student-dashboard\.html'\)/);
    expect(block).toMatch(/res\.redirect\('\/login\.html'\)/);
  });

  it('the dashboard hides the assistant until the server says otherwise', () => {
    // Both entry points start hidden in the markup, so a failed call leaves a
    // free-track student without a door that would only refuse them.
    expect(dashboard).toMatch(/id="assistantCard"[^>]*style="display:none/);
    expect(dashboard).toMatch(/id="assistantNavBtn"[^>]*style="display:none/);
  });
});

describe('premium lives inside the portal, not in a section of its own', () => {
  it('there is no separate premium page or page route', () => {
    expect(fs.existsSync(path.join(root, 'public/premium.html'))).toBe(false);
    expect(serverJs).not.toMatch(/app\.get\('\/premium'/);
    // the API is still mounted
    expect(serverJs).toMatch(/app\.use\('\/api\/v2\/premium'/);
  });

  it('the dashboard renders it inline, hidden until the server says premium', () => {
    expect(dashboard).toContain('id="premiumPanel"');
    expect(dashboard).toMatch(/id="premiumPanel"[^>]*style="display:none/);
    expect(dashboard).toContain('applyPremiumChrome');
    // nothing links out to a page that no longer exists
    expect(dashboard).not.toMatch(/href='\/premium'|href="\/premium"|location\.href='\/premium'/);
  });

  it('a non-member simply never sees the panel', () => {
    const fn = dashboard.slice(dashboard.indexOf('async function applyPremiumChrome'),
                               dashboard.indexOf('function premiumProjectHtml'));
    expect(fn).toMatch(/if \(!d \|\| !d\.success \|\| !d\.premium\) return;/);
  });

  it('GET /me still answers 200 for a non-member rather than erroring', () => {
    const block = premiumRoutes.slice(premiumRoutes.indexOf("router.get('/me'"), premiumRoutes.indexOf("router.get('/unread'"));
    expect(block).toMatch(/premium: false/);
    expect(block).not.toMatch(/status\(402\)/);
  });

  it('a student can submit an assigned project from the dashboard itself', () => {
    expect(dashboard).toContain('submitPremiumProject');
    expect(dashboard).toMatch(/\/api\/v2\/premium\/projects\/'/);
  });

  it('the premium look is scoped to members only', () => {
    expect(dashboard).toMatch(/body\.is-premium/);
    expect(dashboard).toMatch(/classList\.add\('is-premium'\)/);
  });

  it('a badge is awarded for the plan, and it exists in the catalog', () => {
    expect(benefitsSvc).toMatch(/PLAN_BADGES/);
    const granted = [...benefitsSvc.matchAll(/'(premium_[a-z]+)'/g)].map((m) => m[1]);
    const catalog = [...serverJs.matchAll(/id:"(premium_[a-z]+)"/g)].map((m) => m[1]);
    expect(granted.length).toBeGreaterThan(0);
    granted.forEach((g) => expect(catalog).toContain(g));
  });

  it('re-awarding a badge is an upsert, not a duplicate', () => {
    expect(benefitsSvc).toMatch(/\$setOnInsert/);
    expect(benefitsSvc).toMatch(/upsert: true/);
  });
});

describe('coordinator notes and assigned projects', () => {
  it('every coordinator route is behind requireCoordinator', () => {
    ['/students', '/assign', '/assignments'].forEach((r) => {
      expect(premiumRoutes).toMatch(new RegExp(`'${r}', requireCoordinator`));
    });
    expect(premiumRoutes).toMatch(/'\/projects\/:id\/review', requireCoordinator/);
  });

  it('a coordinator cannot write to a student who could never read it', () => {
    const block = premiumRoutes.slice(premiumRoutes.indexOf("router.post('/assign'"), premiumRoutes.indexOf("router.get('/assignments'"));
    expect(block).toMatch(/if \(!status\.premium\)/);
    expect(block).toMatch(/status\(409\)/);
  });

  it('the student list is scoped to the coordinator’s own domain', () => {
    const block = premiumRoutes.slice(premiumRoutes.indexOf("router.get('/students'"), premiumRoutes.indexOf("router.post('/assign'"));
    expect(block).toMatch(/req\.coordinator && req\.coordinator\.domain/);
    expect(block).toMatch(/getPremiumStatus/);
  });

  it('a student can only submit against their own project', () => {
    const block = premiumRoutes.slice(premiumRoutes.indexOf("router.post('/projects/:id/submit'"), premiumRoutes.indexOf('// ── Coordinator'));
    // id AND session employeeId — a guessed id hits nothing.
    expect(block).toMatch(/_id: req\.params\.id, employeeId: req\.student\.employeeId/);
    expect(block).toMatch(/protocol !== 'http:'/);
  });

  it('asking for changes requires a reason', () => {
    const block = premiumRoutes.slice(premiumRoutes.indexOf("router.post('/projects/:id/review'"));
    expect(block).toMatch(/feedback\.length < 5/);
    expect(block).toMatch(/item\.readAt = null/);   // the verdict is unread again
  });

  it('coordinator identity comes from the session, never the body', () => {
    const block = premiumRoutes.slice(premiumRoutes.indexOf("router.post('/assign'"), premiumRoutes.indexOf("router.get('/assignments'"));
    expect(block).toMatch(/createdBy: \(req\.coordinator && req\.coordinator\.username\)/);
    expect(block).not.toMatch(/createdBy: b\./);
  });

  it('the coordinator dashboard has the screen wired to those endpoints', () => {
    expect(coordPage).toContain('id="tab-premium"');
    expect(coordPage).toContain("openCoordModal('premium')");
    expect(coordPage).toContain("/api/v2/premium/students");
    expect(coordPage).toContain("/api/v2/premium/assign");
  });
});

describe('nothing server-supplied reaches innerHTML unescaped', () => {
  it('the inline premium panel escapes everything it renders', () => {
    expect(dashboard).toMatch(/function pEsc\(/);
    ['a.title', 'a.body', 'b.name', 'a.feedback'].forEach((f) => {
      expect(dashboard).toContain(`pEsc(${f})`);
    });
  });

  it('the coordinator screen escapes what students and staff typed', () => {
    expect(coordPage).toMatch(/function pmEsc\(/);
    ['a.title', 'a.body', 's.employeeId'].forEach((f) => {
      expect(coordPage).toContain(`pmEsc(${f})`);
    });
  });
});

describe('the "Too many requests" wall', () => {
  it('the API limit counts per signed-in person, not per IP', () => {
    // A college lab or office is one public address. Keyed by IP, thirty
    // students shared one 300-request budget and the whole building was
    // throttled — which is what the notifications screen was reporting.
    expect(serverJs).toMatch(/function rateLimitKey\(req\)/);
    expect(serverJs).toMatch(/keyGenerator: rateLimitKey/);
    expect(serverJs).toMatch(/ses\.student && \(ses\.student\.employeeId/);
    // anonymous still falls back to the IP, normalised for IPv6
    expect(serverJs).toMatch(/ip:\$\{ipKeyGenerator\(req\.ip\)\}/);
  });

  it('read-only polling is not what the limiter exists to stop', () => {
    expect(serverJs).toMatch(/skip: \(req\) => req\.method === 'GET'/);
    expect(serverJs).toMatch(/notifications\|messages\|chat/);
  });
});

describe('the resume agent reports what actually happened', () => {
  const agent = fs.readFileSync(path.join(root, 'resume-portal-app/src/components/ResumeAgent.tsx'), 'utf8');

  it('a rate limit no longer reads as "the server is not running"', () => {
    expect(agent).toMatch(/res\.status === 429/);
    expect(agent).not.toMatch(/could not be reached\. Check that the portal server is running/);
  });

  it('the server’s own message is preferred over a generic one', () => {
    expect(agent).toMatch(/data\.error \|\| data\.message/);
  });

  it('the built bundle carries the fix', () => {
    const idx = fs.readFileSync(path.join(root, 'public/resume-portal/index.html'), 'utf8');
    const m = idx.match(/assets\/(index-[\w-]+\.js)/);
    expect(m).not.toBeNull();
    const bundle = fs.readFileSync(path.join(root, 'public/resume-portal/assets', m[1]), 'utf8');
    expect(bundle).toContain('Too many requests just now');
    expect(bundle).not.toContain('Check that the portal server is running');
  });
});

describe('push notifications need keys, not code', () => {
  it('the generator ships, so switching them on is one command', () => {
    expect(fs.existsSync(path.join(root, 'scripts/generate-vapid-keys.js'))).toBe(true);
  });

  it('the portal runs normally with push switched off', () => {
    const push = fs.readFileSync(path.join(root, 'services/pushService.js'), 'utf8');
    expect(push).toMatch(/VAPID_PUBLIC_KEY/);
    expect(push).toMatch(/push notifications are off/);
  });
});
