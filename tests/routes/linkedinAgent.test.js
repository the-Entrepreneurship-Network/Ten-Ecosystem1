'use strict';

/**
 * The LinkedIn section's HTTP surface, proved end to end.
 *
 * There is one endpoint now, and the openings module below it is pure — no
 * database, no key, no socket — so it is loaded for real rather than mocked.
 * That is the whole point of the change this suite pins: there is nothing left
 * under this router that could reach LinkedIn even if a test wanted it to.
 *
 * Half of what is tested here is an absence. The OAuth start and callback, the
 * connect and disconnect, the publish and schedule and delete — all of it was
 * removed, because a bot posting to the company page is what gets the page
 * restricted. A 404 on each of those paths is the assertion that they stay
 * removed, and it is the assertion most likely to earn its keep: those routes
 * are exactly what somebody re-adds when asked to "just make it post again".
 *
 * Identity is forged the same way tests/routes/attendanceAgent.test.js does
 * it: a middleware that reads an `x-test-session` header the real middleware
 * never looks at, and writes the session shape a real login would have
 * written. attachEcosystemUser is then mounted after it, so req.user is built
 * by production code from a production-shaped session rather than being handed
 * to the guard directly. The header cannot name a role, only a session, so the
 * mapping from session to role stays the thing under test.
 */

const express = require('express');
const request = require('supertest');

const { attachEcosystemUser } = require('../../middleware/roleGuard');
const router = require('../../routes/v2/linkedinAgent');
const openings = require('../../services/v2/linkedin/openings');

/*
 * The session shapes a real login writes. Nothing here says "role"; the role is
 * whatever attachEcosystemUser derives from the session, which is exactly the
 * mapping the access-control test is about.
 */
const SESSIONS = {
  hr: () => ({ hr: { username: 'hr1', email: 'hr1@ten.com', name: 'HR One' } }),
  coordinator: () => ({ coordinator: { username: 'py_admin', domain: 'Python' } }),
  admin: () => ({ adminUser: { username: 'root', name: 'Root Admin' } }),
  mentor: () => ({ ecosystemUserId: 'u_mentor', ecosystemUserRole: 'mentor', ecosystemUserName: 'Mentor M' }),
  founder: () => ({ ecosystemUserId: 'u_founder', ecosystemUserRole: 'founder', ecosystemUserName: 'Founder F' }),
  investor: () => ({ ecosystemUserId: 'u_investor', ecosystemUserRole: 'investor', ecosystemUserName: 'Investor I' }),
  contractor: () => ({ ecosystemUserId: 'u_contractor', ecosystemUserRole: 'contractor', ecosystemUserName: 'Contractor C' }),
  student: () => ({ student: { employeeId: 'TEN001', email: 'ten001@x.com' } }),
};

const app = express();
app.use(express.json());
app.use((req, res, next) => {
  const as = req.headers['x-test-session'];
  if (as && Object.prototype.hasOwnProperty.call(SESSIONS, as)) req.session = SESSIONS[as]();
  next();
});
app.use(attachEcosystemUser);
app.use('/api/v2/linkedin', router);

const as = (role) => (role ? { 'x-test-session': role } : {});

describe('GET /openings — what the section reads', () => {
  test('answers with all fourteen openings', async () => {
    const res = await request(app).get('/api/v2/linkedin/openings').set(as('hr'));
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.openings).toHaveLength(14);
  });

  test('each opening carries the text, the poster and the apply link', async () => {
    const res = await request(app).get('/api/v2/linkedin/openings').set(as('coordinator'));
    for (const o of res.body.openings) {
      expect(typeof o.slug).toBe('string');
      expect(typeof o.name).toBe('string');
      expect(o.text.length).toBeGreaterThan(500);
      expect(o.applyUrl).toMatch(/^https:\/\//);
      expect(o.alt.length).toBeGreaterThan(20);
      expect(o.posters.length).toBeGreaterThanOrEqual(1);
      for (const p of o.posters) expect(p.url).toMatch(/^\/assets\/linkedin-posters\/[a-z]+(-ten)?\.jpg$/);
    }
  });

  test('the text it serves is the text the module generates — one source of truth', async () => {
    const res = await request(app).get('/api/v2/linkedin/openings').set(as('admin'));
    const python = res.body.openings.find((o) => o.slug === 'python');
    expect(python.text).toBe(openings.text('python'));
  });

  test('and that text states the stipend once, with no invented figure', async () => {
    const res = await request(app).get('/api/v2/linkedin/openings').set(as('coordinator'));
    for (const o of res.body.openings) {
      expect(o.text).toContain('Stipend: Competitive salary along with terms and conditions');
      expect(o.text).not.toContain('₹');
      expect(o.text.toLowerCase()).not.toContain('unpaid');
    }
  });

  test('lists only poster variants that exist, so no download can 404', async () => {
    const res = await request(app).get('/api/v2/linkedin/openings').set(as('hr'));
    for (const o of res.body.openings) {
      const expected = openings.posters(o.slug).map((p) => p.url);
      expect(o.posters.map((p) => p.url)).toEqual(expected);
    }
  });
});

describe('who may read it', () => {
  /*
   * Three roles, and the list is exhaustive on both sides.
   *
   * An earlier version admitted every signed-in role on the argument that
   * fourteen interns sharing an opening outreach one company page. That was
   * overruled: this is hiring copy in draft, and who posts it and when is the
   * hiring team's decision. The five refusals below are the half that matters —
   * the UI is stripped from those portals too, but a stripped dashboard is a
   * courtesy and this is the control.
   */
  const ALLOWED = ['hr', 'coordinator', 'admin'];
  const REFUSED = ['student', 'mentor', 'founder', 'investor', 'contractor'];

  test('the two lists together cover every role the suite knows about', () => {
    expect([...ALLOWED, ...REFUSED].sort()).toEqual(Object.keys(SESSIONS).sort());
  });

  for (const role of ALLOWED) {
    test(`${role} can read the openings`, async () => {
      const res = await request(app).get('/api/v2/linkedin/openings').set(as(role));
      expect(res.status).toBe(200);
      expect(res.body.openings).toHaveLength(14);
    });
  }

  for (const role of REFUSED) {
    test(`${role} is refused`, async () => {
      const res = await request(app).get('/api/v2/linkedin/openings').set(as(role));
      expect(res.status).toBe(403);
      /* Not just the status — a refusal that still leaked the copy in its body
         would pass a status check and fail the point of the gate. */
      expect(JSON.stringify(res.body)).not.toContain('Apply for');
      expect(JSON.stringify(res.body)).not.toContain('WE ARE');
    });
  }

  test('an anonymous request is refused', async () => {
    const res = await request(app).get('/api/v2/linkedin/openings');
    expect(res.status).toBe(401);
    expect(JSON.stringify(res.body)).not.toContain('Apply for');
  });

  test('a session the app does not recognise is refused', async () => {
    const res = await request(app).get('/api/v2/linkedin/openings').set({ 'x-test-session': 'nobody' });
    expect(res.status).toBe(401);
  });
});

describe('the posting surface stays gone', () => {
  /*
   * This is the group that matters in a year. Each of these routes existed,
   * each one let this server act on LinkedIn, and all of them were removed
   * together. If one comes back, it comes back here first.
   */
  const publishing = [
    ['get', '/api/v2/linkedin/oauth/start'],
    ['get', '/api/v2/linkedin/oauth/callback'],
    ['post', '/api/v2/linkedin/connect'],
    ['post', '/api/v2/linkedin/disconnect'],
    ['get', '/api/v2/linkedin/status'],
    ['get', '/api/v2/linkedin/stats'],
    ['get', '/api/v2/linkedin/feed'],
    ['get', '/api/v2/linkedin/posts'],
    ['post', '/api/v2/linkedin/posts'],
    ['post', '/api/v2/linkedin/publish'],
    ['post', '/api/v2/linkedin/schedule'],
  ];

  for (const [method, url] of publishing) {
    test(`${method.toUpperCase()} ${url} is gone`, async () => {
      const res = await request(app)[method](url).set(as('admin'));
      expect(res.status).toBe(404);
    });
  }
});

describe('what it does not say', () => {
  test('the payload carries no credential, page id or operational field', async () => {
    const res = await request(app).get('/api/v2/linkedin/openings').set(as('admin'));
    const body = JSON.stringify(res.body).toLowerCase();
    for (const forbidden of [
      'token', 'urn:li:organization', 'client_secret', 'clientsecret',
      'authorization', 'orgurn', 'expiresat', 'dryrun', 'scheduledfor',
    ]) {
      expect(body).not.toContain(forbidden);
    }
  });

  test('the router pulls in nothing that could reach LinkedIn', () => {
    const loaded = Object.keys(require.cache).filter((f) => /linkedin/i.test(f));
    expect(loaded.some((f) => /linkedinClient|autopilot|scheduler|LinkedInPost/.test(f))).toBe(false);
  });
});
