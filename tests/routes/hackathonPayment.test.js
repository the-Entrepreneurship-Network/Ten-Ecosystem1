'use strict';

/**
 * @jest-environment node
 *
 * Hackathon & Ideathon: register + pay by QR, admin-verified, no email, no
 * student login. The portal is deliberately self-contained — a public entrant
 * fills a form, pays the entry fee by UPI, and an admin (not HR) confirms it.
 *
 * The sandbox has no MongoDB, so the model tests exercise the schema directly
 * and the flow tests assert on the route/UI source — the same pattern the rest
 * of this suite uses.
 */

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '../..');
const hackRoutes  = fs.readFileSync(path.join(root, 'routes/v2/hackathons.js'), 'utf8');
const adminRoutes = fs.readFileSync(path.join(root, 'routes/adminPortal.js'), 'utf8');
const adminPage   = fs.readFileSync(path.join(root, 'public/ten-admin.html'), 'utf8');
const eventBoard  = fs.readFileSync(path.join(root, 'hackathon-portal-app/src/components/EventBoard.tsx'), 'utf8');
const appTsx      = fs.readFileSync(path.join(root, 'hackathon-portal-app/src/App.tsx'), 'utf8');

describe('the models carry the entry fee and the payment state', () => {
  const Hackathon = require('../../models/Hackathon');
  const HackathonTeam = require('../../models/HackathonTeam');

  it('an event has a per-event entry fee, defaulting to 200', () => {
    const p = Hackathon.schema.path('entryFee');
    expect(p).toBeDefined();
    expect(new Hackathon({ title: 'X', slug: 'x' }).entryFee).toBe(200);
  });

  it('a team tracks its own payment, starting unpaid', () => {
    ['paymentStatus', 'paymentRef', 'paymentAmount', 'leadPhone', 'verifiedBy', 'rejectionReason']
      .forEach((f) => expect(HackathonTeam.schema.path(f)).toBeDefined());
    const t = new HackathonTeam({ hackathonId: '000000000000000000000000', name: 'T', leadEmail: 'a@b.com' });
    expect(t.paymentStatus).toBe('unpaid');
  });

  it('payment status is limited to the four real states', () => {
    expect(HackathonTeam.schema.path('paymentStatus').enumValues)
      .toEqual(['unpaid', 'pending', 'confirmed', 'rejected']);
  });
});

describe('public registration — no login, pay pending, admin to verify', () => {
  const block = hackRoutes.slice(
    hackRoutes.indexOf("router.post('/:slug/register-public'"),
    hackRoutes.indexOf("router.post('/teams/:id/submit'")
  );

  it('the endpoint takes no auth middleware (anyone can register)', () => {
    expect(hackRoutes).toMatch(/router\.post\('\/:slug\/register-public', registerLimiter, async/);
    // registerLimiter is a rate limiter, not an auth guard.
    expect(block).not.toContain('requireStudent');
    expect(block).not.toContain('requireRole');
  });

  it('validates name, email, phone and the UPI reference', () => {
    expect(block).toMatch(/Enter a valid email/);
    expect(block).toMatch(/Enter a valid phone number/);
    expect(block).toMatch(/Enter the UPI reference/);
  });

  it('stores the team payment-pending with the reference', () => {
    expect(block).toMatch(/paymentStatus: 'pending'/);
    expect(block).toMatch(/paymentRef: utr/);
  });

  it('charges the event fee, never an amount the browser sent', () => {
    expect(block).toMatch(/paymentAmount: event\.entryFee/);
    expect(block).not.toMatch(/paymentAmount:\s*\w*body/);
  });

  it('sends no email on this path', () => {
    expect(block).not.toMatch(/sendMail|transporter|nodemailer|createEmailTransporter/);
  });

  it('the status lookup is declared before /:slug so it is not swallowed', () => {
    expect(hackRoutes.indexOf("router.get('/registration-status'"))
      .toBeLessThan(hackRoutes.indexOf("router.get('/:slug'"));
  });

  it('the QR shown is the static Paytm QR and its UPI identity', () => {
    expect(hackRoutes).toContain("require('../../config/payment')");
    expect(hackRoutes).toMatch(/qrImage: '\/paytm-qr\.jpeg'/);
    expect(hackRoutes).toMatch(/upiId: BUSINESS_UPI\.upiId/);
  });
});

describe('admin verifies it — not HR', () => {
  it('the queue and verify endpoints are admin-guarded', () => {
    expect(adminRoutes).toMatch(/router\.get\('\/hackathon-registrations', requireAdminAPI/);
    expect(adminRoutes).toMatch(/router\.post\('\/hackathon-registrations\/:id\/verify', requireAdminAPI/);
  });

  it('approving confirms the team; rejecting needs a reason', () => {
    const v = adminRoutes.slice(adminRoutes.indexOf("router.post('/hackathon-registrations/:id/verify'"));
    expect(v).toMatch(/team\.paymentStatus = 'confirmed'/);
    expect(v).toMatch(/team\.status = 'confirmed'/);
    expect(v).toMatch(/team\.paymentStatus = 'rejected'/);
    expect(v).toMatch(/at least 5 characters/);
  });

  it('only pending registrations can be acted on', () => {
    const v = adminRoutes.slice(adminRoutes.indexOf("router.post('/hackathon-registrations/:id/verify'"));
    expect(v).toMatch(/already \$\{team\.paymentStatus\}/);
  });

  it('the admin console has its own Hackathons section', () => {
    expect(adminPage).toContain("showSection('hackathons')");
    expect(adminPage).toContain('id="section-hackathons"');
    expect(adminPage).toContain('function loadHackathonRegs');
    expect(adminPage).toContain('/hackathon-registrations/');
  });
});

describe('the portal is self-contained — no loop into the student portal', () => {
  it('the register button no longer bounces to the student login', () => {
    expect(eventBoard).not.toContain('student-login.html');
    expect(appTsx).not.toContain('student-login.html');
  });

  it('registration happens in-portal against the public endpoint', () => {
    expect(eventBoard).toContain("import Register");
    const reg = fs.readFileSync(path.join(root, 'hackathon-portal-app/src/components/Register.tsx'), 'utf8');
    expect(reg).toMatch(/\/api\/v2\/hackathons\/\$\{event\.slug\}\/register-public/);
    expect(reg).toContain('/api/v2/hackathons/registration-status');
  });

  it('the built bundle is regenerated and referenced by the page', () => {
    const builtIndex = fs.readFileSync(path.join(root, 'public/hackathon-portal/index.html'), 'utf8');
    const m = builtIndex.match(/assets\/(index-[\w-]+\.js)/);
    expect(m).not.toBeNull();
    expect(fs.existsSync(path.join(root, 'public/hackathon-portal/assets', m[1]))).toBe(true);
  });
});
