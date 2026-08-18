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
const teamPanel   = fs.readFileSync(path.join(root, 'hackathon-portal-app/src/components/Team.tsx'), 'utf8');
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

  it('the QR carries the real UPI identity', () => {
    expect(hackRoutes).toContain("require('../../config/payment')");
    expect(hackRoutes).toMatch(/qrImage: `\/api\/v2\/hackathons\/qr\?amount=/);
    expect(hackRoutes).toMatch(/upiId: BUSINESS_UPI\.upiId/);
    expect(hackRoutes).toMatch(/pa=' \+ encodeURIComponent\(BUSINESS_UPI\.upiId\)/);
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

describe('admin can create the event — without one the portal is empty', () => {
  it('the admin console has create/list/manage endpoints, admin-guarded', () => {
    expect(adminRoutes).toMatch(/router\.get\('\/hackathon-events', requireAdminAPI/);
    expect(adminRoutes).toMatch(/router\.post\('\/hackathon-events', requireAdminAPI/);
    expect(adminRoutes).toMatch(/router\.patch\('\/hackathon-events\/:id', requireAdminAPI/);
    expect(adminRoutes).toMatch(/router\.delete\('\/hackathon-events\/:id', requireAdminAPI/);
  });

  it('a new event goes live by default so the portal shows it right away', () => {
    const block = adminRoutes.slice(
      adminRoutes.indexOf("router.post('/hackathon-events'"),
      adminRoutes.indexOf("router.patch('/hackathon-events/:id'")
    );
    // live (published + registration_open) unless explicitly saved as draft
    expect(block).toMatch(/const live = b\.live !== false/);
    expect(block).toMatch(/status: live \? 'registration_open' : 'draft'/);
    expect(block).toMatch(/published: live/);
  });

  it('deleting is blocked once an event has registrations (cancel instead)', () => {
    const block = adminRoutes.slice(adminRoutes.indexOf("router.delete('/hackathon-events/:id'"));
    expect(block).toMatch(/countDocuments\(\{ hackathonId: req\.params\.id \}\)/);
    expect(block).toMatch(/Cancel it instead of deleting/);
  });

  it('the admin console UI can create and manage events', () => {
    expect(adminPage).toContain('openNewHackathonEvent');
    expect(adminPage).toContain('function createHackathonEvent');
    expect(adminPage).toContain("api('/hackathon-events'");
    expect(adminPage).toContain('loadHackathonEvents');
  });
});

describe('the portal always has something to register for', () => {
  it('an empty database falls back to an open pool event, not a dead end', () => {
    expect(hackRoutes).toMatch(/const POOL_SLUG = 'ten-hackathon-ideathon'/);
    const fn = hackRoutes.slice(
      hackRoutes.indexOf('async function ensurePoolEvent'),
      hackRoutes.indexOf("router.get('/',")
    );
    expect(fn).toMatch(/status: 'registration_open'/);
    expect(fn).toMatch(/published: true/);
    // The list route uses it when nothing is published.
    const list = hackRoutes.slice(hackRoutes.indexOf("router.get('/',"), hackRoutes.indexOf("router.get('/me/teams'"));
    expect(list).toMatch(/await ensurePoolEvent\(\)/);
  });

  it('staff closing or cancelling the pool is respected, not overwritten', () => {
    const fn = hackRoutes.slice(
      hackRoutes.indexOf('async function ensurePoolEvent'),
      hackRoutes.indexOf("router.get('/',")
    );
    // An existing doc is never recreated or re-published behind staff's back.
    expect(fn).toMatch(/if \(existing\)/);
    expect(fn).toMatch(/existing\.published && existing\.status !== 'cancelled' \? existing : null/);
  });

  it('a race on first load does not 500', () => {
    const fn = hackRoutes.slice(
      hackRoutes.indexOf('async function ensurePoolEvent'),
      hackRoutes.indexOf("router.get('/',")
    );
    expect(fn).toMatch(/err\.code === 11000/);
  });

  it('REGISTER opens the form instead of landing on the status box', () => {
    // #events only scrolls — and with the status checker there, that was the bug.
    expect(appTsx).toContain('href="#register"');
    expect(eventBoard).toMatch(/h === '#register'/);
    expect(eventBoard).toMatch(/setRegistering\(toRegEvent\(events\[0\]\)\)/);
    // A click only changes the hash — without this the form never opens.
    expect(eventBoard).toMatch(/addEventListener\('hashchange', open\)/);
    // Closing clears the hash, so the same button works a second time.
    expect(eventBoard).toMatch(/history\.replaceState/);
  });

  it('the empty state no longer promises a form that is not there', () => {
    expect(eventBoard).not.toMatch(/register below and you are in the pool/);
  });
});

describe('the QR is generated, because the committed one is corrupt', () => {
  it('public/paytm-qr.jpeg is not a valid image — do not serve it', () => {
    const buf = fs.readFileSync(path.join(root, 'public/paytm-qr.jpeg'));
    // A real JPEG starts FF D8 FF. This file starts with UTF-8 replacement
    // characters, which is why the payment step showed a broken image box.
    expect(buf.slice(0, 3).toString('hex')).not.toBe('ffd8ff');
  });

  it('the portal points at the generated QR route instead', () => {
    expect(hackRoutes).toMatch(/qrImage: `\/api\/v2\/hackathons\/qr\?amount=/);
    expect(hackRoutes).toMatch(/router\.get\('\/qr'/);
    // declared before /:slug or the slug route eats it
    expect(hackRoutes.indexOf("router.get('/qr'")).toBeLessThan(hackRoutes.indexOf("router.get('/:slug'"));
  });

  it('that route really produces a PNG carrying the UPI id and amount', async () => {
    const QRCode = require('qrcode');
    const link = 'upi://pay?pa=paytmqr5k0ods@ptys&pn=Limitless&am=200&cu=INR';
    const png = await QRCode.toBuffer(link, { type: 'png', width: 480, margin: 1 });
    expect(png.slice(0, 4).toString('hex')).toBe('89504e47');  // PNG magic
    expect(png.length).toBeGreaterThan(500);
  });
});

describe('invite by link, capped at the team size, with no email', () => {
  it('a team carries its own code, uniquely and sparsely indexed', () => {
    const HackathonTeam = require('../../models/HackathonTeam');
    expect(HackathonTeam.schema.path('code')).toBeDefined();
    // No default: "" on every legacy team would all collide on one value.
    const t = new HackathonTeam({ hackathonId: '000000000000000000000000', name: 'T', leadEmail: 'a@b.com' });
    expect(t.code).toBeUndefined();
  });

  it('a teammate joins with a name alone — email is not required', () => {
    const HackathonTeam = require('../../models/HackathonTeam');
    expect(HackathonTeam.schema.path('members').schema.path('email').isRequired).toBeFalsy();
    const t = new HackathonTeam({ hackathonId: '000000000000000000000000', name: 'T',
      leadEmail: 'a@b.com', members: [{ name: 'No Email Person' }] });
    expect(t.validateSync()).toBeUndefined();
  });

  it('codes come from the CSPRNG, not Math.random', () => {
    const gen = hackRoutes.slice(
      hackRoutes.indexOf('function newTeamCode'),
      hackRoutes.indexOf('/** The fields a visitor may see')
    );
    expect(gen).toMatch(/crypto\.randomBytes\(8\)/);
    expect(gen).not.toMatch(/Math\.random/);
  });

  it('the server enforces the cap — it never trusts the browser', () => {
    const join = hackRoutes.slice(
      hackRoutes.indexOf("router.post('/team/:code/join'"),
      hackRoutes.indexOf("router.patch('/team/:code'")
    );
    expect(join).toMatch(/const max = \(event && event\.maxTeamSize\) \|\| 4/);
    expect(join).toMatch(/This team is full/);
    expect(join).not.toMatch(/req\.body.*maxTeamSize/);
    // joining needs no email at all
    expect(join).not.toMatch(/leadEmail|body\.email/);
  });

  it('a registration hands back the code so the lead can invite and sign in', () => {
    expect(hackRoutes).toMatch(/code: team\.code,/);
    expect(hackRoutes).toMatch(/code: newTeamCode\(\)/);
  });

  it('the invite link and the dashboard never leak the lead contact details', () => {
    const payloadFn = hackRoutes.slice(
      hackRoutes.indexOf('function teamPayload'),
      hackRoutes.indexOf('async function findByCode')
    );
    expect(payloadFn).not.toMatch(/leadEmail|leadPhone/);
  });
});

describe('sign in and the team dashboard', () => {
  it('the code is the login — lookup, join, edit and submit all route through it', () => {
    ['/team/:code', '/team/:code/join', '/team/:code/submit'].forEach((r) => {
      expect(hackRoutes).toContain(r);
    });
    expect(hackRoutes.indexOf("router.get('/team/:code'"))
      .toBeLessThan(hackRoutes.indexOf("router.get('/:slug'"));
  });

  it('submissions stay shut until an admin confirms the payment', () => {
    const sub = hackRoutes.slice(hackRoutes.indexOf("router.post('/team/:code/submit'"));
    expect(sub).toMatch(/team\.paymentStatus !== 'confirmed'/);
    expect(sub).toMatch(/Submissions open once an admin confirms/);
  });

  it('the portal has a dashboard, an invite link and a sign-in', () => {
    expect(teamPanel).toMatch(/\/api\/v2\/hackathons\/team\//);
    expect(teamPanel).toMatch(/#join=/);
    expect(teamPanel).toMatch(/localStorage/);
    expect(eventBoard).toContain('TeamPanel');
    expect(eventBoard).toMatch(/h\.startsWith\('#join='\)/);
  });

  it('the admin queue shows the code, so staff can read it back to a caller', () => {
    expect(adminRoutes).toMatch(/code: t\.code \|\| '',/);
    expect(adminPage).toContain('r.code');
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
