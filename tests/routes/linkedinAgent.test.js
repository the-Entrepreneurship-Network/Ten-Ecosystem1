'use strict';

/**
 * The LinkedIn agent's HTTP surface, proved end to end with nothing real
 * behind it.
 *
 * Every route in this router reads. The posts themselves are written by the
 * autopilot and sent by the scheduler, both crons, neither of which
 * runs under test — so what is under test here is the router plus
 * services/v2/linkedin/autopilot.js, which the router calls with no injected
 * dependencies and therefore loads for real. Below that, the LinkedIn client,
 * the LLM probe, the poster studio and both mongoose models are replaced with
 * fakes, by path, so that:
 *
 *   - the suite has no database, no LinkedIn token, no API key and no socket,
 *     which is the only way the promise "a test run can never post to the
 *     company page" can be kept;
 *   - a regression in a sibling module cannot turn this file red. They are
 *     mocked `{ virtual: true }`, so jest does not care whether the file on
 *     disk parses — a route regression must be visible on its own.
 *
 * One group of tests here exists to keep something absent rather than to prove
 * something present: there must be no route that publishes, schedules, edits
 * or deletes a post. That surface was removed on purpose, and a 404 on each of
 * those paths is the assertion that it stays removed.
 *
 * Identity is forged the same way tests/routes/attendanceAgent.test.js does
 * it: a middleware that reads an `x-test-session` header the real middleware
 * never looks at, and writes the session shape a real login would have
 * written. attachEcosystemUser is then mounted after it, so req.user is built
 * by production code from a production-shaped session rather than being handed
 * to the guard directly. That distinction matters: the header cannot name a
 * role, it can only name a session, and the mapping from session to role stays
 * the one thing under test.
 */

/* ── the modules under the router, all faked ────────────────────────────── */

jest.mock('../../services/v2/linkedin/llm', () => ({
  provider: jest.fn(() => null),
  generateJSON: jest.fn(async () => null),
}), { virtual: true });

jest.mock('../../services/v2/linkedin/linkedinClient', () => ({
  API_BASE: 'https://api.linkedin.com/rest',
  DEFAULT_SCOPES: ['w_organization_social', 'r_organization_social', 'rw_organization_admin'],
  config: jest.fn(),
  headers: jest.fn(() => ({})),
  escapeCommentary: jest.fn((s) => String(s == null ? '' : s)),
  publish: jest.fn(),
  shareStatistics: jest.fn(),
  oauthUrl: jest.fn(),
  exchangeCode: jest.fn(),
  resolveOrganization: jest.fn(),
  listAdministeredOrganizations: jest.fn(),
}), { virtual: true });

/*
 * The poster studio is stubbed rather than used, even though it is one of the
 * modules that already exists: the route only ever passes its output through,
 * and a fake keeps the SVG assertions about the route's content type and
 * caching rather than about the studio's typography. See the note in the
 * integrator report — the real file does not currently parse, so requiring it
 * here would take the whole suite down with it.
 */
jest.mock('../../services/v2/linkedin/posterStudio', () => ({
  TEMPLATES: ['opening', 'placement', 'leadgen', 'general'],
  BRAND: { name: 'The Entrepreneurship Network', short: 'TEN' },
  fieldsFor: jest.fn((kind, extracted) => Object.assign({ template: kind }, extracted || {})),
  build: jest.fn(({ template, fields }) => ({
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 1200" data-template="${template || 'general'}"><title>${(fields && fields.headline) || 'poster'}</title></svg>`,
    width: 1200,
    height: 1200,
    template: template || 'general',
    alt: 'A square poster for The Entrepreneurship Network',
    fields: fields || {},
  })),
}));

/*
 * An in-memory stand-in for the LinkedInPost collection. It answers the exact
 * slice of mongoose the agent and the router lean on — a chainable query that
 * is also a promise, $set with dotted paths, $push, and countDocuments — and
 * nothing else. Keeping the documents inside the factory (rather than in a
 * module-scope variable the factory closes over) sidesteps jest's hoisting of
 * jest.mock above every declaration in the file.
 */
jest.mock('../../models/LinkedInPost', () => {
  let seq = 0;
  const docs = [];
  const nextId = () => {
    seq += 1;
    return seq.toString(16).padStart(24, '0');
  };
  const clone = (d) => (d == null ? null : JSON.parse(JSON.stringify(d)));

  /* Answers sort/limit/select/lean and is awaitable, so the same object serves
     `await Model.find(f)` and `await Model.find(f).sort(...).lean()` alike. */
  function chain(get) {
    const q = {
      sort: () => q,
      limit: () => q,
      select: () => q,
      lean: () => q,
      then: (onOk, onErr) => Promise.resolve().then(get).then(onOk, onErr),
      catch: (onErr) => Promise.resolve().then(get).catch(onErr),
    };
    return q;
  }

  function matches(filter) {
    const f = filter || {};
    return (doc) => Object.keys(f).every((key) => {
      const want = f[key];
      const have = doc[key];
      if (want && typeof want === 'object' && !(want instanceof Date)) {
        if (Array.isArray(want.$in)) return want.$in.indexOf(have) >= 0;
        if (want.$gte != null && !(have && new Date(have).getTime() >= new Date(want.$gte).getTime())) return false;
        if (want.$lte != null && !(have && new Date(have).getTime() <= new Date(want.$lte).getTime())) return false;
        if (want.$lt != null && !(have && new Date(have).getTime() < new Date(want.$lt).getTime())) return false;
        return true;
      }
      return have === want;
    });
  }

  /* `poster.png` arrives as a dotted key in $set; a naive assignment would
     create a literal "poster.png" property and the scheduler would never find
     the image again. */
  function setPath(doc, path, value) {
    const parts = String(path).split('.');
    let cur = doc;
    for (let i = 0; i < parts.length - 1; i += 1) {
      if (!cur[parts[i]] || typeof cur[parts[i]] !== 'object') cur[parts[i]] = {};
      cur = cur[parts[i]];
    }
    cur[parts[parts.length - 1]] = value;
  }

  const Model = {
    __docs: docs,
    __reset() { docs.length = 0; seq = 0; },
    __seed(doc) {
      const d = Object.assign({ _id: nextId(), history: [], createdAt: new Date() }, doc || {});
      docs.push(d);
      return d;
    },
    __byId(id) { return docs.find((d) => String(d._id) === String(id)) || null; },
    find: jest.fn((filter) => chain(() => docs.filter(matches(filter)).map(clone))),
    findById: jest.fn((id) => chain(() => clone(docs.find((d) => String(d._id) === String(id)) || null))),
    countDocuments: jest.fn((filter) => Promise.resolve(docs.filter(matches(filter)).length)),
    create: jest.fn(async (doc) => Model.__seed(doc)),
    findByIdAndUpdate: jest.fn((id, update) => chain(() => {
      const doc = docs.find((d) => String(d._id) === String(id));
      if (!doc) return null;
      const u = update || {};
      if (u.$set) Object.keys(u.$set).forEach((k) => setPath(doc, k, u.$set[k]));
      if (u.$push) {
        Object.keys(u.$push).forEach((k) => {
          if (!Array.isArray(doc[k])) doc[k] = [];
          doc[k].push(u.$push[k]);
        });
      }
      return doc;
    })),
    findOneAndUpdate: jest.fn(() => chain(() => null)),
    /* The one pipeline the autopilot runs: count the documents by status. It
       is implemented rather than stubbed so the numbers on the dashboard card
       are derived from the seeded documents, which is what makes a test that
       seeds three published posts and expects "3" mean anything. */
    aggregate: jest.fn(async (pipeline) => {
      const group = (pipeline || []).find((s) => s && s.$group);
      if (!group || group.$group._id !== '$status') throw new Error('unexpected pipeline in the test double');
      const by = {};
      docs.forEach((d) => { by[d.status] = (by[d.status] || 0) + 1; });
      return Object.keys(by).map((k) => ({ _id: k, n: by[k] }));
    }),
  };
  return Model;
});

jest.mock('../../models/LinkedInConnection', () => ({
  findOneAndUpdate: jest.fn(async () => ({ key: 'default' })),
  findOne: jest.fn(() => ({ select: () => ({ lean: () => Promise.resolve(null) }) })),
}));

/* ── the app under test ─────────────────────────────────────────────────── */

const express = require('express');
const request = require('supertest');

const { attachEcosystemUser } = require('../../middleware/roleGuard');
const router = require('../../routes/v2/linkedinAgent');
const agent = require('../../services/v2/linkedin/agent');

const client = require('../../services/v2/linkedin/linkedinClient');
const llm = require('../../services/v2/linkedin/llm');
const posters = require('../../services/v2/linkedin/posterStudio');
const LinkedInPost = require('../../models/LinkedInPost');

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
app.use(express.json({ limit: '6mb' }));
app.use((req, res, next) => {
  const as = req.headers['x-test-session'];
  if (as && Object.prototype.hasOwnProperty.call(SESSIONS, as)) req.session = SESSIONS[as]();
  next();
});
app.use(attachEcosystemUser);
app.use('/api/v2/linkedin', router);

const as = (role) => (role ? { 'x-test-session': role } : {});
const get = (path, role) => request(app).get(`/api/v2/linkedin${path}`).set(as(role));
const post = (path, body, role) => request(app).post(`/api/v2/linkedin${path}`).set(as(role)).send(body || {});

/*
 * superagent has no parser for image/svg+xml, so it hands the response back as
 * a Buffer and leaves `res.text` undefined. Reading the body through this
 * helper keeps the SVG assertions about what the route sent rather than about
 * which parser happened to claim the content type.
 */
function bodyText(res) {
  if (typeof res.text === 'string') return res.text;
  if (Buffer.isBuffer(res.body)) return res.body.toString('utf8');
  return String(res.body == null ? '' : res.body);
}

const ALLOWED = ['hr', 'coordinator', 'mentor', 'founder', 'admin'];
const REFUSED = ['student', 'investor', 'contractor'];

const CONNECTED_CONFIG = {
  configured: true,
  orgUrn: 'urn:li:organization:12345',
  orgName: 'The Entrepreneurship Network',
  apiVersion: '202609',
  source: 'db',
  expiresAt: new Date(Date.now() + 30 * 24 * 3600 * 1000),
  expiresInDays: 30,
  warning: '',
  /* Deliberately present. config() promises never to return the token, but the
     route must not depend on that promise — publicConfig() names its fields
     explicitly, and this is what proves it. */
  accessToken: 'AQX-SUPER-SECRET-TOKEN',
  refreshToken: 'AQX-SUPER-SECRET-REFRESH',
};

const DRY_RUN_RESULT = {
  ok: false,
  dryRun: true,
  payload: {
    author: 'urn:li:organization:12345',
    commentary: 'escaped commentary',
    visibility: 'PUBLIC',
    distribution: { feedDistribution: 'MAIN_FEED', targetEntities: [], thirdPartyDistributionChannels: [] },
    lifecycleState: 'PUBLISHED',
    charCount: 120,
    imageBytes: 0,
  },
};

const ENV_KEYS = ['LINKEDIN_CLIENT_ID', 'LINKEDIN_CLIENT_SECRET', 'LINKEDIN_REDIRECT_URI', 'LINKEDIN_ORG_ID'];
const savedEnv = {};

beforeAll(() => {
  ENV_KEYS.forEach((k) => { savedEnv[k] = process.env[k]; });
});

afterAll(() => {
  ENV_KEYS.forEach((k) => {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  });
});

beforeEach(() => {
  jest.clearAllMocks();
  LinkedInPost.__reset();
  /* No OAuth credentials unless a test says so — the unconfigured answer is
     the default state of a fresh deployment and should be what most tests see. */
  ENV_KEYS.forEach((k) => { delete process.env[k]; });

  client.config.mockReturnValue(Object.assign({}, CONNECTED_CONFIG));
  client.publish.mockResolvedValue(Object.assign({}, DRY_RUN_RESULT));
  client.shareStatistics.mockResolvedValue(null);
  client.oauthUrl.mockImplementation(({ clientId, redirectUri, state, scopes }) => (
    `https://www.linkedin.com/oauth/v2/authorization?response_type=code&client_id=${encodeURIComponent(clientId)}`
    + `&redirect_uri=${encodeURIComponent(redirectUri)}&state=${encodeURIComponent(state)}`
    + `&scope=${encodeURIComponent((scopes || []).join(' '))}`
  ));
  client.exchangeCode.mockResolvedValue(null);
  client.resolveOrganization.mockResolvedValue(null);
  client.listAdministeredOrganizations.mockResolvedValue([]);
  llm.provider.mockReturnValue(null);
});

/* A draft with nothing wrong in it that also matches none of the agent's
   command intents — an ordinary HR opening, which is the common case. */
const CLEAN_DRAFT = 'we are hiring python interns, remote, 2 months, stipend 5000, apply by 25 sept';

/** Draft, then reply on the session the browser would have carried back. */
async function chat(message, session, role, body) {
  const res = await post('/chat', Object.assign({ message, session: session || {} }, body || {}), role || 'hr');
  expect(res.status).toBe(200);
  return res.body;
}

describe('routes/v2/linkedinAgent — who may use it', () => {
  it('lets HR, coordinators, mentors, founders and admins into the staff views', async () => {
    for (const role of ALLOWED) {
      const status = await get('/status', role);
      expect(status.status).toBe(200);
      expect(status.body.ok).toBe(true);
      expect(status.body.role).toBe(role === 'admin' ? 'admin' : role);
    }
  });

  /*
   * The feed is the one route everybody reads, and this is the test that says
   * so. It is the opposite of what this file asserted a version ago, when the
   * section was a composer and had to be kept away from students. It is not a
   * composer any more — it shows the company's own published posts, which the
   * students are the audience for.
   */
  it('lets every signed-in role read the feed, students and investors included', async () => {
    for (const role of ALLOWED.concat(REFUSED)) {
      const res = await get('/feed', role);
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(Array.isArray(res.body.posts)).toBe(true);
    }
  });

  it('still refuses students, investors and contractors everywhere else', async () => {
    for (const role of REFUSED) {
      expect((await get('/status', role)).status).toBe(403);
      expect((await get('/posts', role)).status).toBe(403);
      expect((await get('/stats', role)).status).toBe(403);
      expect((await get('/oauth/start', role)).status).toBe(403);
    }
  });

  it('refuses a request with no session at all with 401, feed included', async () => {
    expect((await get('/status')).status).toBe(401);
    expect((await get('/feed')).status).toBe(401);
    expect((await get('/posts')).status).toBe(401);
  });

  /*
   * The manual surface is gone, and it has to stay gone. A publish route left
   * mounted "just in case" is a second way for text to reach the company page,
   * one with no rotation behind it and no slot key — which is precisely the
   * arrangement the autopilot replaced.
   */
  it('has no route that writes, publishes, schedules or deletes a post', async () => {
    expect((await post('/chat', { message: 'hello' }, 'hr')).status).toBe(404);
    expect((await post('/posts/000000000000000000000001/publish', {}, 'hr')).status).toBe(404);
    expect((await post('/posts/000000000000000000000001/schedule', { when: 'tomorrow 10am' }, 'hr')).status).toBe(404);
    const del = await request(app)
      .delete('/api/v2/linkedin/posts/000000000000000000000001')
      .set(as('hr'));
    expect(del.status).toBe(404);
  });
});

describe('routes/v2/linkedinAgent — GET /status', () => {
  it('reports the connection without ever returning the token', async () => {
    const res = await get('/status', 'hr');
    expect(res.status).toBe(200);
    expect(res.body.linkedin).toEqual({
      configured: true,
      orgUrn: 'urn:li:organization:12345',
      orgName: 'The Entrepreneurship Network',
      apiVersion: '202609',
      source: 'db',
      expiresAt: CONNECTED_CONFIG.expiresAt.toISOString(),
      expiresInDays: 30,
    });
    expect(JSON.stringify(res.body)).not.toContain('SECRET');
  });

  it('warns when the token is nearly out of time, and when it is gone', async () => {
    client.config.mockReturnValue(Object.assign({}, CONNECTED_CONFIG, { expiresInDays: 3 }));
    expect((await get('/status', 'hr')).body.warning).toMatch(/expires in 3 days/i);

    client.config.mockReturnValue(Object.assign({}, CONNECTED_CONFIG, { expiresInDays: -1 }));
    expect((await get('/status', 'hr')).body.warning).toMatch(/expired/i);
  });

  it('survives a client that is not configured, and tells a mentor they cannot connect', async () => {
    client.config.mockReturnValue({ configured: false, source: 'none' });
    const res = await get('/status', 'mentor');
    expect(res.status).toBe(200);
    expect(res.body.linkedin.configured).toBe(false);
    expect(res.body.canConnect).toBe(false);
  });

  it('answers even when the client throws on load', async () => {
    client.config.mockImplementation(() => { throw new Error('no config'); });
    const res = await get('/status', 'hr');
    expect(res.status).toBe(200);
    expect(res.body.linkedin.configured).toBe(false);
  });
});

describe('routes/v2/linkedinAgent — GET /feed', () => {
  /* Two published (one of them a dry run), one failed, one still queued —
     enough that the feed has to pick correctly rather than pass everything
     through. */
  function seedHistory() {
    LinkedInPost.__seed({
      status: 'published', source: 'autopilot', domain: 'Python Development',
      final: '🚀 WE ARE #HIRING #INTERNS | The Entrepreneurship Network (TEN)\n\nrest of the post',
      publishedAt: new Date('2026-09-12T04:30:00Z'), dryRun: false,
      linkedin: { url: 'https://www.linkedin.com/feed/update/urn:li:share:1/' },
      poster: { withImage: true, png: 'QUFB', fields: { alt: 'Hiring poster: Python Development Intern' } },
    });
    LinkedInPost.__seed({
      status: 'published', source: 'autopilot', domain: 'Web Development',
      final: 'second one', publishedAt: new Date('2026-09-13T04:30:00Z'), dryRun: true,
      poster: { withImage: true, png: 'QUFB' },
    });
    LinkedInPost.__seed({
      status: 'failed', source: 'autopilot', domain: 'HR',
      final: 'the one that did not send', error: 'LinkedIn refused the post',
      createdAt: new Date('2026-09-06T04:30:00Z'),
    });
    LinkedInPost.__seed({
      status: 'scheduled', source: 'autopilot', domain: 'Data Science',
      final: 'tomorrow\'s post', scheduledFor: new Date('2026-09-19T04:30:00Z'),
    });
  }

  it('returns the published posts, whole, to anybody signed in', async () => {
    seedHistory();
    const res = await get('/feed', 'student');
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(2);
    expect(res.body.posts).toHaveLength(2);

    const python = res.body.posts.find((p) => p.domain === 'Python Development');
    /* The whole text, not an excerpt — the section exists to show what was said. */
    expect(python.text).toContain('WE ARE #HIRING #INTERNS');
    expect(python.text).toContain('rest of the post');
    expect(python.url).toContain('linkedin.com');
    expect(python.live).toBe(true);
    expect(python.alt).toContain('Python Development Intern');
  });

  it('shows neither what failed nor what has not gone out yet', async () => {
    seedHistory();
    const body = JSON.stringify((await get('/feed', 'student')).body);
    /* A queued post is tomorrow's announcement; the feed must not be a way to
       read it today. A failed one was never said at all. */
    expect(body).not.toContain('Data Science');
    expect(body).not.toContain("tomorrow's post");
    expect(body).not.toContain('did not send');
    expect(body).not.toContain('LinkedIn refused');
  });

  it('flags a post that was recorded but never sent', async () => {
    seedHistory();
    const res = await get('/feed', 'contractor');
    expect(res.body.posts.find((p) => p.domain === 'Web Development').live).toBe(false);
    expect(res.body.posts.find((p) => p.domain === 'Python Development').live).toBe(true);
  });

  it('points at the committed plate for a domain in the rotation', async () => {
    seedHistory();
    const res = await get('/feed', 'investor');
    expect(res.body.posts.find((p) => p.domain === 'Python Development').image)
      .toBe('/assets/linkedin-posters/python.jpg');
  });

  it('falls back to the stored image for a post the rotation does not know', async () => {
    LinkedInPost.__seed({
      status: 'published', domain: 'Underwater Basket Weaving', final: 'x',
      publishedAt: new Date('2026-09-14T04:30:00Z'),
      poster: { withImage: true, png: 'QUFB' },
    });
    const res = await get('/feed', 'mentor');
    expect(res.body.posts[0].image).toMatch(/^\/api\/v2\/linkedin\/feed\/[a-f0-9]{24}\/image$/);
  });

  it('gives a text-only post no image rather than a broken one', async () => {
    LinkedInPost.__seed({
      status: 'published', domain: 'Space', final: 'text only',
      publishedAt: new Date('2026-09-14T04:30:00Z'),
      poster: { withImage: false, png: '' },
    });
    expect((await get('/feed', 'student')).body.posts[0].image).toBe('');
  });

  /*
   * The point of the whole change: a student opening this section sees the
   * posts and nothing that is anybody's business but the team's.
   */
  it('tells a student nothing operational', async () => {
    seedHistory();
    const res = await get('/feed', 'student');
    expect(Object.keys(res.body).sort()).toEqual(['count', 'ok', 'posts']);
    expect(res.body.connected).toBeUndefined();
    expect(res.body.canConnect).toBeUndefined();
    const body = JSON.stringify(res.body);
    expect(body).not.toContain('scheduled');
    expect(body).not.toContain('forecast');
    expect(body).not.toContain('SECRET');
  });

  it('tells HR, and only HR, whether the page still needs connecting', async () => {
    client.config.mockReturnValue({ configured: false, source: 'none' });
    const hr = await get('/feed', 'hr');
    expect(hr.body.canConnect).toBe(true);
    expect(hr.body.connected).toBe(false);

    const coordinator = await get('/feed', 'coordinator');
    expect(coordinator.body.canConnect).toBeUndefined();
    expect(coordinator.body.connected).toBeUndefined();
  });

  it('never puts the poster payload itself in the feed', async () => {
    LinkedInPost.__seed({
      status: 'published', domain: 'Java Development', final: 'x',
      publishedAt: new Date('2026-09-14T04:30:00Z'),
      poster: { withImage: true, png: 'AAAABBBBCCCC', svg: '<svg/>' },
    });
    const body = JSON.stringify((await get('/feed', 'hr')).body);
    expect(body).not.toContain('AAAABBBBCCCC');
    expect(body).not.toContain('<svg');
  });
});

describe('routes/v2/linkedinAgent — GET /feed/:id/image', () => {
  it('serves the stored bytes of a published post to anybody signed in', async () => {
    /* "AAA" as base64 — not a real JPEG, which is the point: the route must
       not inspect it beyond the magic number it uses to choose a type. */
    const doc = LinkedInPost.__seed({
      status: 'published', domain: 'Space', final: 'x',
      poster: { withImage: true, png: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2]).toString('base64') },
    });
    const res = await get(`/feed/${doc._id}/image`, 'student');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/image\/jpeg/);
  });

  it('answers a PNG as image/png rather than guessing jpeg', async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
    const doc = LinkedInPost.__seed({
      status: 'published', domain: 'Space', final: 'x',
      poster: { withImage: true, png: png.toString('base64') },
    });
    const res = await get(`/feed/${doc._id}/image`, 'student');
    expect(res.headers['content-type']).toMatch(/image\/png/);
  });

  it('will not serve the image of a post that has not been published', async () => {
    const queued = LinkedInPost.__seed({
      status: 'scheduled', domain: 'Space', final: 'x',
      poster: { withImage: true, png: 'QUFB' },
    });
    expect((await get(`/feed/${queued._id}/image`, 'student')).status).toBe(404);
  });

  it('404s a text-only post and an id that is not an ObjectId', async () => {
    const textOnly = LinkedInPost.__seed({
      status: 'published', domain: 'Space', final: 'x',
      poster: { withImage: false, png: '' },
    });
    expect((await get(`/feed/${textOnly._id}/image`, 'student')).status).toBe(404);
    expect((await get('/feed/not-an-id/image', 'student')).status).toBe(404);
  });

  it('refuses an anonymous request', async () => {
    const doc = LinkedInPost.__seed({
      status: 'published', domain: 'Space', final: 'x',
      poster: { withImage: true, png: 'QUFB' },
    });
    expect((await get(`/feed/${doc._id}/image`)).status).toBe(401);
  });
});

describe('routes/v2/linkedinAgent — posts', () => {
  function seedPost(over) {
    return LinkedInPost.__seed(Object.assign({
      kind: 'opening',
      source: 'autopilot',
      domain: 'Python Development',
      draft: '',
      final: 'FINAL TEXT that the autopilot wrote',
      verdict: 'ok',
      status: 'published',
      poster: { template: 'domain-hiring', fields: { domain: 'Python Development' }, svg: '<svg id="a"/>', png: 'SGVsbG8=', withImage: true },
      history: [],
      createdAt: new Date(),
    }, over || {}));
  }

  it('lists recent posts without the poster payloads', async () => {
    seedPost();
    seedPost({ domain: 'Space', final: 'another' });
    const res = await get('/posts', 'mentor');
    expect(res.status).toBe(200);
    expect(res.body.posts).toHaveLength(2);
    res.body.posts.forEach((p) => {
      expect(p.poster).toBeUndefined();
      expect(p.id).toBeTruthy();
      expect(p.source).toBe('autopilot');
    });
    expect(JSON.stringify(res.body)).not.toContain('SGVsbG8=');
  });

  it('returns one post with the browser PNG stripped out', async () => {
    const doc = seedPost();
    const res = await get(`/posts/${doc._id}`, 'hr');
    expect(res.status).toBe(200);
    expect(res.body.post.final).toBe('FINAL TEXT that the autopilot wrote');
    expect(res.body.post.poster.png).toBeUndefined();
    expect(res.body.post.poster.svg).toBe('<svg id="a"/>');
  });

  it('404s an id that is not an ObjectId, without asking the database', async () => {
    const res = await get('/posts/not-an-id', 'hr');
    expect(res.status).toBe(404);
    expect(LinkedInPost.findById).not.toHaveBeenCalled();
  });

  it('serves the poster as image/svg+xml, stored or rebuilt', async () => {
    const stored = seedPost();
    const a = await get(`/posts/${stored._id}/poster.svg`, 'hr');
    expect(a.status).toBe(200);
    expect(a.headers['content-type']).toMatch(/image\/svg\+xml/);
    expect(bodyText(a)).toBe('<svg id="a"/>');

    const bare = seedPost({ poster: { template: 'opening', fields: { role: 'Python Intern' }, svg: '', withImage: true } });
    const b = await get(`/posts/${bare._id}/poster.svg`, 'hr');
    expect(b.status).toBe(200);
    expect(posters.build).toHaveBeenCalled();
    expect(bodyText(b)).toContain('<svg');
  });
});

describe('routes/v2/linkedinAgent — OAuth', () => {
  it('is 400 when no client id is configured, even for HR', async () => {
    const res = await get('/oauth/start', 'hr');
    expect(res.status).toBe(400);
    expect(client.oauthUrl).not.toHaveBeenCalled();
  });

  it('redirects HR to LinkedIn with a state and the default scopes', async () => {
    process.env.LINKEDIN_CLIENT_ID = 'client-abc';
    process.env.LINKEDIN_REDIRECT_URI = 'https://portal.example/api/v2/linkedin/oauth/callback';
    const res = await request(app).get('/api/v2/linkedin/oauth/start').set(as('hr'));
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('linkedin.com/oauth/v2/authorization');
    expect(res.headers.location).toContain('client_id=client-abc');
    expect(res.headers.location).toMatch(/state=[^&]{16,}/);
    expect(res.headers.location).toContain(encodeURIComponent('w_organization_social'));
  });

  it('is 403 for a mentor, who may read the section but may not connect the page', async () => {
    process.env.LINKEDIN_CLIENT_ID = 'client-abc';
    process.env.LINKEDIN_REDIRECT_URI = 'https://portal.example/cb';
    expect((await get('/oauth/start', 'mentor')).status).toBe(403);
    expect((await get('/oauth/start', 'coordinator')).status).toBe(403);
    expect((await get('/oauth/start', 'founder')).status).toBe(403);
  });

  it('refuses a callback whose state was never issued here', async () => {
    process.env.LINKEDIN_CLIENT_ID = 'client-abc';
    process.env.LINKEDIN_CLIENT_SECRET = 'shhh';
    process.env.LINKEDIN_REDIRECT_URI = 'https://portal.example/cb';
    const res = await get('/oauth/callback?code=abc&state=never-issued', 'hr');
    expect(res.status).toBe(400);
    expect(client.exchangeCode).not.toHaveBeenCalled();
  });
});

describe('routes/v2/linkedinAgent — GET /stats', () => {
  it('says so when LinkedIn is not connected, and passes the numbers through when it is', async () => {
    client.config.mockReturnValue({ configured: false, source: 'none' });
    const off = await get('/stats', 'hr');
    expect(off.status).toBe(200);
    expect(off.body.ok).toBe(false);
    expect(client.shareStatistics).not.toHaveBeenCalled();

    client.config.mockReturnValue(Object.assign({}, CONNECTED_CONFIG));
    client.shareStatistics.mockResolvedValue({ impressions: 1200, clicks: 42 });
    const on = await get('/stats', 'hr');
    expect(on.body).toEqual({ ok: true, stats: { impressions: 1200, clicks: 42 } });
  });
});
