'use strict';

/**
 * The LinkedIn agent's HTTP surface, proved end to end with nothing real
 * behind it.
 *
 * What this file is actually testing is two layers at once: the router in
 * routes/v2/linkedinAgent.js and the conversation in
 * services/v2/linkedin/agent.js, which the router calls with no injected
 * dependencies and therefore loads for real. Everything BELOW the agent —
 * the content guard, the composer, the LLM, the LinkedIn client, the
 * scheduler, the poster studio and both mongoose models — is replaced here
 * with a fake, by path, so that:
 *
 *   - the suite has no database, no LinkedIn token, no API key and no socket,
 *     which is the only way the promise "a test run can never post to the
 *     company page" can be kept;
 *   - the file stands alone while those sibling modules are still being
 *     written. They are mocked `{ virtual: true }`, so jest does not care
 *     whether the file exists on disk yet. The bug that prevents is the whole
 *     route suite going red because somebody else's module has a typo in it —
 *     a route regression must be visible on its own.
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

/* ── the modules under the agent, all faked ─────────────────────────────── */

/*
 * The guard's verdict is keyed off two markers in the text rather than any
 * real analysis. The router does not care how a draft came to be blocked, only
 * what happens afterwards, and a marker keeps the publishing tests honest: the
 * text that reaches the mocked publish() can be compared against the words the
 * person typed, character for character.
 */
jest.mock('../../services/v2/linkedin/contentGuard', () => {
  const statsFor = (t) => ({
    chars: t.length,
    words: t.split(/\s+/).filter(Boolean).length,
    lines: t.split('\n').length,
    hashtags: 0,
    emojis: 0,
    capsRatio: 0,
    exclamations: 0,
    links: [],
  });
  return {
    BRAND: { name: 'The Entrepreneurship Network', short: 'TEN' },
    CODES: {},
    review: jest.fn((text) => {
      const t = String(text == null ? '' : text);
      if (t.indexOf('BLOCKME') >= 0) {
        return {
          verdict: 'block',
          /* hate_slur is on the agent's UNRECOVERABLE list, so this draft has
             no salvageable version and the agent must refuse outright. */
          issues: [{
            code: 'hate_slur',
            severity: 'block',
            excerpt: 'BLOCKME',
            message: 'that word has no place on the company page',
            fix: 'take it out and say what you mean plainly',
          }],
          cleaned: '',
          stats: statsFor(t),
        };
      }
      if (t.indexOf('REVISEME') >= 0) {
        return {
          verdict: 'revise',
          issues: [{
            code: 'shouting',
            severity: 'revise',
            excerpt: 'REVISEME',
            message: 'most of this line is capitals',
            fix: 'sentence case reads as confident, capitals read as shouting',
          }],
          cleaned: t.replace(/REVISEME/g, 'Reviseme'),
          stats: statsFor(t),
        };
      }
      return { verdict: 'ok', issues: [], cleaned: t, stats: statsFor(t) };
    }),
  };
}, { virtual: true });

/*
 * The composer's only job here is to be recognisably NOT the draft. Every
 * composed text carries the 'COMPOSED BODY ::' marker and quotes the source it
 * was given, which is what lets the publishing tests assert that the version
 * LinkedIn was offered is the reviewed one and not the raw draft.
 */
jest.mock('../../services/v2/linkedin/postComposer', () => {
  const build = (source, opts) => {
    const o = opts || {};
    const kind = o.kind || 'general';
    const hook = `COMPOSED HOOK — ${kind} post`;
    const body = `COMPOSED BODY :: ${String(source == null ? '' : source).trim()}`;
    const cta = 'Apply at virtualinternships.entrepreneurshipnetwork.net';
    const hashtags = ['#TheEntrepreneurshipNetwork', '#TEN', '#Internships'];
    const text = [hook, '', body, '', cta, '', hashtags.join(' ')].join('\n');
    return { hook, body, cta, hashtags, text, kind, chars: text.length };
  };
  const reassemble = (c) => {
    const text = [c.hook, '', c.body, '', c.cta, '', (c.hashtags || []).join(' ')].join('\n');
    return Object.assign({}, c, { text, chars: text.length });
  };
  return {
    detectKind: jest.fn(() => 'opening'),
    extractFields: jest.fn(() => ({
      role: 'Python Intern',
      domain: 'Python Development',
      mode: 'Remote',
      stipend: '5,000/month',
      duration: '2 months',
      applyBy: '25 Sep',
      studentName: '',
      company: '',
      position: '',
      location: '',
      ctaUrl: 'https://virtualinternships.entrepreneurshipnetwork.net',
    })),
    compose: jest.fn((source, opts) => build(source, opts)),
    composeWithLLM: jest.fn(async () => null),
    transform: jest.fn((composed, op, arg) => {
      const next = Object.assign({}, composed);
      if (op === 'headline') next.hook = String(arg == null ? next.hook : arg);
      if (op === 'cta') next.cta = String(arg == null ? next.cta : arg);
      if (op === 'hashtags' && Array.isArray(arg)) next.hashtags = arg;
      if (op === 'shorter') next.body = String(next.body).slice(0, 40);
      return reassemble(next);
    }),
    assemble: jest.fn(reassemble),
  };
}, { virtual: true });

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

jest.mock('../../services/v2/linkedin/scheduler', () => ({
  start: jest.fn(),
  runDue: jest.fn(async () => ({ published: 0, failed: 0 })),
  parseWhen: jest.fn(() => null),
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

const guard = require('../../services/v2/linkedin/contentGuard');
const composer = require('../../services/v2/linkedin/postComposer');
const client = require('../../services/v2/linkedin/linkedinClient');
const scheduler = require('../../services/v2/linkedin/scheduler');
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
  scheduler.parseWhen.mockReturnValue(null);
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
  it('lets HR, coordinators, mentors, founders and admins in', async () => {
    for (const role of ALLOWED) {
      const status = await get('/status', role);
      expect(status.status).toBe(200);
      expect(status.body.ok).toBe(true);
      expect(status.body.role).toBe(role);

      expect((await get('/posts', role)).status).toBe(200);
      expect((await post('/chat', { message: 'help', session: {} }, role)).status).toBe(200);
    }
  });

  it('refuses students, investors and contractors with 403 on every route', async () => {
    for (const role of REFUSED) {
      for (const path of ['/status', '/posts', '/stats']) {
        const res = await get(path, role);
        expect(res.status).toBe(403);
        expect(res.body.yourRole).toBe(role);
      }
      expect((await post('/chat', { message: 'hello' }, role)).status).toBe(403);
      /* The OAuth pair is narrower still, but for these roles the answer is
         the same 403 — they never reach the client-id check. */
      expect((await get('/oauth/start', role)).status).toBe(403);
    }
  });

  it('refuses a request with no session at all with 401', async () => {
    for (const path of ['/status', '/posts', '/stats', '/oauth/start']) {
      const res = await get(path);
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    }
    expect((await post('/chat', { message: 'hello' })).status).toBe(401);
    /* An unknown header names nobody: it must not be read as a role. */
    const bluffed = await request(app).get('/api/v2/linkedin/status').set({ 'x-test-session': 'founder-ish', 'x-ecosystem-user-role': 'admin' });
    expect(bluffed.status).toBe(401);
  });
});

describe('routes/v2/linkedinAgent — GET /status', () => {
  it('reports the connection without ever returning the token', async () => {
    llm.provider.mockReturnValue('openai');
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
    expect(res.body.llm).toBe('openai');
    expect(res.body.canConnect).toBe(true);
    /* NODE_ENV is 'test' under jest, so the cron must report itself off. */
    expect(res.body.scheduler).toEqual({ enabled: false });
    expect(res.body.warning).toBe('');
    /* The strongest form of the assertion: the token never appears anywhere in
       the raw response body, under any key. */
    expect(res.text).not.toContain('SUPER-SECRET');
    expect(res.text).not.toContain('accessToken');
  });

  it('warns when the token is nearly out of time, and when it is gone', async () => {
    client.config.mockReturnValue(Object.assign({}, CONNECTED_CONFIG, { expiresInDays: 3 }));
    const soon = await get('/status', 'hr');
    expect(soon.body.warning).toBe('The LinkedIn token expires in 3 days — reconnect soon.');

    client.config.mockReturnValue(Object.assign({}, CONNECTED_CONFIG, { expiresInDays: -1 }));
    const gone = await get('/status', 'hr');
    expect(gone.body.warning).toBe('The LinkedIn token has expired — reconnect the page to post again.');
  });

  it('survives a client that is not configured, and tells a mentor they cannot connect', async () => {
    client.config.mockReturnValue({ configured: false, orgUrn: '', apiVersion: '202609', source: 'none' });
    const res = await get('/status', 'mentor');
    expect(res.status).toBe(200);
    expect(res.body.linkedin.configured).toBe(false);
    expect(res.body.canConnect).toBe(false);
    expect(res.body.warning).toBe('');
  });

  it('answers even when the client throws on load', async () => {
    client.config.mockImplementation(() => { throw new Error('module blew up'); });
    llm.provider.mockImplementation(() => { throw new Error('no provider'); });
    const res = await get('/status', 'founder');
    expect(res.status).toBe(200);
    expect(res.body.linkedin.configured).toBe(false);
    expect(res.body.llm).toBe(null);
  });
});

describe('routes/v2/linkedinAgent — POST /chat', () => {
  it('reviews a clean draft and returns the review, the poster and the options', async () => {
    const body = await chat(CLEAN_DRAFT);

    expect(body.ok).toBe(true);
    expect(body.kind).toBe('review');
    expect(body.review.verdict).toBe('ok');
    expect(body.review.original).toBe(CLEAN_DRAFT);

    /* What would go out is the composed version, not the typed one. */
    expect(body.post.text).toContain('COMPOSED BODY ::');
    expect(body.post.text).not.toBe(CLEAN_DRAFT);
    expect(body.review.final).toBe(body.post.text);
    expect(body.review.chars).toBe(body.post.text.length);

    /*
     * No poster by default. The image that goes out is whatever the author
     * attached; the agent draws a branded square only when asked, because
     * otherwise it is choosing the picture on the company's post and the
     * person who typed the words never chose it.
     */
    expect(body.poster).toBeNull();
    expect(posters.build).not.toHaveBeenCalled();

    const labels = body.options.options.map((o) => o.label);
    expect(labels).toEqual(expect.arrayContaining(['Post now', 'Schedule', 'Shorter', 'Regenerate', 'No image']));

    /* The session comes back for the browser to carry, and it carries the
       final rather than only the draft. */
    expect(body.session.final).toBe(body.post.text);
    expect(body.session.kind).toBe('opening');
    expect(guard.review).toHaveBeenCalledWith(CLEAN_DRAFT, { kind: 'opening' });
    expect(composer.compose).toHaveBeenCalled();
  });

  it('answers "help" without touching the composer or the database', async () => {
    const body = await chat('help');
    expect(body.kind).toBe('help');
    expect(body.reply).toBe(agent.helpText);
    expect(composer.compose).not.toHaveBeenCalled();
    expect(client.publish).not.toHaveBeenCalled();
  });
});

describe('routes/v2/linkedinAgent — publishing through /chat', () => {
  it('publishes nothing at all when the draft was blocked', async () => {
    const drafted = await chat(`BLOCKME ${CLEAN_DRAFT}`);
    expect(drafted.kind).toBe('refused');
    expect(drafted.session.verdict).toBe('block');
    expect(drafted.session.final).toBe('');
    expect(drafted.post).toBeUndefined();
    /* The refusal quotes the reason but must not hand the blocked draft back
       in the agent's voice. */
    expect(drafted.review.original).toBe('');
    expect(drafted.reply).toContain('that word has no place on the company page');

    const attempted = await chat('post it', drafted.session);
    expect(attempted.kind).toBe('refused');
    expect(client.publish).not.toHaveBeenCalled();
    expect(LinkedInPost.create).not.toHaveBeenCalled();
    expect(LinkedInPost.__docs).toHaveLength(0);

    /* Even a forged session that smuggles the blocked text back in as `final`
       is re-reviewed at the moment of publishing and refused there. */
    const forged = Object.assign({}, drafted.session, { final: `BLOCKME ${CLEAN_DRAFT}`, verdict: 'ok' });
    const smuggled = await chat('post it', forged);
    expect(smuggled.kind).toBe('refused');
    expect(client.publish).not.toHaveBeenCalled();
  });

  it('publishes the FINAL text of a revised draft, never the draft itself', async () => {
    const drafted = await chat(`REVISEME ${CLEAN_DRAFT}`);
    expect(drafted.kind).toBe('review');
    expect(drafted.review.verdict).toBe('revise');

    const final = drafted.post.text;
    expect(final).toContain('Reviseme');
    expect(final).not.toContain('REVISEME');

    const posted = await chat('post it', drafted.session);
    expect(posted.kind).toBe('posted');

    expect(client.publish).toHaveBeenCalledTimes(1);
    const sent = client.publish.mock.calls[0][0];
    expect(sent.text).toBe(final);
    expect(sent.text).not.toContain('REVISEME');
    expect(sent.text).not.toContain(`REVISEME ${CLEAN_DRAFT}`);
    expect(sent.altText).toBe('The Entrepreneurship Network — image attached to this post');
    /* No PNG was rasterised by the browser, so nothing is uploaded. */
    expect(sent.png).toBeUndefined();

    /* And the record keeps both texts, with only the final one ever sent. */
    const saved = LinkedInPost.__docs[0];
    expect(saved.final).toBe(final);
    expect(saved.draft).toBe(`REVISEME ${CLEAN_DRAFT}`);
    expect(saved.status).toBe('published');
    expect(saved.history.map((h) => h.action)).toEqual(['created', 'publishing', 'dry-run']);
  });

  it('shows the dry-run notice when LinkedIn is not connected', async () => {
    const drafted = await chat(CLEAN_DRAFT);
    const posted = await chat('post it', drafted.session);

    expect(posted.publish.dryRun).toBe(true);
    expect(posted.publish.ok).toBe(false);
    expect(posted.publish.payload).toEqual(DRY_RUN_RESULT.payload);
    expect(posted.reply).toContain(agent.DRY_RUN_NOTICE);
    expect(posted.reply).toContain('dry run');
    /* A dry run is still recorded, flagged, so nobody reads it as a real post. */
    expect(LinkedInPost.__docs[0].dryRun).toBe(true);
    /* Nothing secret rides along with the payload. */
    expect(JSON.stringify(posted)).not.toContain('SUPER-SECRET');
  });

  it('reports a real publish with the post URL and clears the session for the next one', async () => {
    client.publish.mockResolvedValue({
      ok: true,
      dryRun: false,
      postUrn: 'urn:li:share:7100',
      imageUrn: 'urn:li:image:C4E',
      url: 'https://www.linkedin.com/feed/update/urn:li:share:7100',
    });
    const drafted = await chat(CLEAN_DRAFT);
    const posted = await chat('post it', drafted.session);

    expect(posted.publish.ok).toBe(true);
    expect(posted.publish.dryRun).toBe(false);
    expect(posted.reply).toContain('https://www.linkedin.com/feed/update/urn:li:share:7100');
    expect(posted.session.final).toBe('');
    expect(posted.session.lastPostId).toBe(posted.publish.postId);
    expect(LinkedInPost.__docs[0].linkedin.url).toBe('https://www.linkedin.com/feed/update/urn:li:share:7100');
  });

  it('records a refusal from LinkedIn as a failed post the chat can retry', async () => {
    client.publish.mockResolvedValue({ ok: false, dryRun: false, code: 'unauthorized', error: 'token rejected (expired or revoked) — reconnect LinkedIn' });
    const drafted = await chat(CLEAN_DRAFT);
    const posted = await chat('post it', drafted.session);

    expect(posted.publish.ok).toBe(false);
    expect(posted.publish.dryRun).toBe(false);
    expect(posted.reply).toContain('token rejected');
    const saved = LinkedInPost.__docs[0];
    expect(saved.status).toBe('failed');
    expect(saved.error).toContain('token rejected');
    /* The id stays on the session so "post it" retries rather than redrafts. */
    expect(posted.session.postId).toBe(posted.publish.postId);
  });
});

describe('routes/v2/linkedinAgent — scheduling through /chat', () => {
  it('parses a time, asks for confirmation, and stores the scheduled post', async () => {
    const when = new Date(Date.now() + 20 * 3600 * 1000);
    scheduler.parseWhen.mockReturnValue(when);

    const drafted = await chat(CLEAN_DRAFT);
    const asked = await chat('schedule tomorrow 10am', drafted.session);
    expect(asked.kind).toBe('ask');
    expect(scheduler.parseWhen).toHaveBeenCalledWith('tomorrow 10am', expect.any(Date), 'Asia/Kolkata');
    expect(asked.session.scheduleFor).toBe(when.toISOString());

    const done = await chat('yes', asked.session);
    expect(done.kind).toBe('scheduled');
    expect(done.scheduledFor).toBe(when.toISOString());
    expect(client.publish).not.toHaveBeenCalled();

    const saved = LinkedInPost.__docs[0];
    expect(saved.status).toBe('scheduled');
    expect(new Date(saved.scheduledFor).toISOString()).toBe(when.toISOString());
    expect(saved.final).toBe(drafted.post.text);
  });

  it('says so, and schedules nothing, when the time cannot be read', async () => {
    scheduler.parseWhen.mockReturnValue(null);
    const drafted = await chat(CLEAN_DRAFT);
    const asked = await chat('schedule on the twelfth of never', drafted.session);
    expect(asked.kind).toBe('ask');
    expect(asked.reply).toContain("couldn't read");
    expect(LinkedInPost.__docs).toHaveLength(0);
  });
});

describe('routes/v2/linkedinAgent — posts', () => {
  const seedPost = (over) => LinkedInPost.__seed(Object.assign({
    kind: 'opening',
    draft: 'we are hiring python interns',
    final: 'COMPOSED HOOK — opening post\n\nCOMPOSED BODY :: we are hiring python interns',
    verdict: 'ok',
    status: 'ready',
    poster: { template: 'opening', fields: { headline: 'Python interns' }, svg: '<svg xmlns="http://www.w3.org/2000/svg"><title>stored</title></svg>', png: 'aGVsbG8=', withImage: true },
    linkedin: { postUrn: '', imageUrn: '', url: '' },
  }, over || {}));

  it('lists recent posts without the poster payloads', async () => {
    seedPost({ status: 'published', publishedAt: new Date(), dryRun: true });
    seedPost({ kind: 'placement', status: 'scheduled', scheduledFor: new Date(Date.now() + 3600 * 1000) });

    const res = await get('/posts', 'coordinator');
    expect(res.status).toBe(200);
    expect(res.body.posts).toHaveLength(2);
    const [first] = res.body.posts;
    expect(first.id).toMatch(/^[a-f0-9]{24}$/);
    expect(first.kind).toBe('opening');
    expect(first.status).toBe('published');
    expect(first.dryRun).toBe(true);
    expect(res.text).not.toContain('<svg');
    expect(res.text).not.toContain('aGVsbG8=');
  });

  it('returns one post with the browser PNG stripped out', async () => {
    const doc = seedPost();
    const res = await get(`/posts/${doc._id}`, 'hr');
    expect(res.status).toBe(200);
    expect(res.body.post.poster.png).toBeUndefined();
    expect(res.body.post.poster.svg).toContain('<svg');
    /* Stripped from the answer, not from the record — the scheduler needs it. */
    expect(LinkedInPost.__byId(doc._id).poster.png).toBe('aGVsbG8=');
  });

  it('404s an id that is not an ObjectId, without asking the database', async () => {
    const res = await get('/posts/not-an-id', 'hr');
    expect(res.status).toBe(404);
    expect(LinkedInPost.findById).not.toHaveBeenCalled();
  });

  it('serves the poster as image/svg+xml, stored or rebuilt', async () => {
    const stored = seedPost();
    const res = await get(`/posts/${stored._id}/poster.svg`, 'mentor');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/^image\/svg\+xml/);
    expect(res.headers['cache-control']).toBe('private, max-age=300');
    expect(bodyText(res)).toContain('<title>stored</title>');

    /* A scheduled post saved before the SVG existed is rebuilt from its
       fields rather than answered with nothing. */
    const bare = seedPost({ poster: { template: 'placement', fields: { headline: 'Priya at Infosys' }, svg: '', withImage: true } });
    const rebuilt = await get(`/posts/${bare._id}/poster.svg`, 'mentor');
    expect(rebuilt.status).toBe(200);
    expect(rebuilt.headers['content-type']).toMatch(/^image\/svg\+xml/);
    expect(bodyText(rebuilt)).toContain('Priya at Infosys');
    expect(posters.build).toHaveBeenCalledWith({ template: 'placement', fields: { headline: 'Priya at Infosys' }, size: 'square' });
  });

  it('schedules a stored post from the dashboard', async () => {
    const doc = seedPost();
    const when = new Date(Date.now() + 6 * 3600 * 1000);
    scheduler.parseWhen.mockReturnValue(when);

    const res = await post(`/posts/${doc._id}/schedule`, { when: 'tomorrow 10am', pngBase64: 'data:image/png;base64,aGVsbG8=' }, 'hr');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, scheduledFor: when.toISOString(), scheduledForText: agent.istDateTime(when) });
    expect(scheduler.parseWhen).toHaveBeenCalledWith('tomorrow 10am', expect.any(Date), 'Asia/Kolkata');

    const saved = LinkedInPost.__byId(doc._id);
    expect(saved.status).toBe('scheduled');
    expect(saved.scheduledFor).toBe(when);
    /* The data: prefix is stripped, and the dotted key lands inside poster. */
    expect(saved.poster.png).toBe('aGVsbG8=');
    expect(saved.history[saved.history.length - 1].action).toBe('scheduled');
  });

  it('refuses to schedule without a time, with an unreadable time, or with no approved text', async () => {
    const doc = seedPost();

    const missing = await post(`/posts/${doc._id}/schedule`, {}, 'hr');
    expect(missing.status).toBe(400);
    expect(scheduler.parseWhen).not.toHaveBeenCalled();

    scheduler.parseWhen.mockReturnValue(null);
    const unreadable = await post(`/posts/${doc._id}/schedule`, { when: 'whenever' }, 'hr');
    expect(unreadable.status).toBe(400);
    expect(unreadable.body.error).toContain('whenever');

    const blocked = seedPost({ final: '', verdict: 'block' });
    scheduler.parseWhen.mockReturnValue(new Date(Date.now() + 3600 * 1000));
    const refused = await post(`/posts/${blocked._id}/schedule`, { when: 'tomorrow 10am' }, 'hr');
    expect(refused.status).toBe(422);
    expect(LinkedInPost.__byId(blocked._id).status).toBe('ready');
  });

  it('publishes a stored post using its final text alone', async () => {
    const doc = seedPost();
    const res = await post(`/posts/${doc._id}/publish`, {}, 'founder');
    expect(res.status).toBe(200);
    expect(res.body.dryRun).toBe(true);
    expect(res.body.notice).toBe(agent.DRY_RUN_NOTICE);
    const sent = client.publish.mock.calls[0][0];
    expect(sent.text).toBe(doc.final);
    /* The stored browser PNG is used when the request carries none. */
    expect(Buffer.isBuffer(sent.png)).toBe(true);
    expect(LinkedInPost.__byId(doc._id).status).toBe('published');
  });

  it('will not publish a blocked post, or one that is already live', async () => {
    const blocked = seedPost({ final: '', verdict: 'block' });
    expect((await post(`/posts/${blocked._id}/publish`, {}, 'hr')).status).toBe(422);

    const live = seedPost({ status: 'published', dryRun: false });
    expect((await post(`/posts/${live._id}/publish`, {}, 'hr')).status).toBe(409);
    expect(client.publish).not.toHaveBeenCalled();
  });
});

describe('routes/v2/linkedinAgent — OAuth', () => {
  it('is 400 when no client id is configured, even for HR', async () => {
    const res = await get('/oauth/start', 'hr');
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('LINKEDIN_CLIENT_ID');
    expect(client.oauthUrl).not.toHaveBeenCalled();
  });

  it('redirects HR to LinkedIn with a state and the default scopes', async () => {
    process.env.LINKEDIN_CLIENT_ID = 'client-abc';
    process.env.LINKEDIN_REDIRECT_URI = 'https://ten.example/api/v2/linkedin/oauth/callback';

    const res = await get('/oauth/start', 'hr');
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('https://www.linkedin.com/oauth/v2/authorization');
    expect(res.headers.location).toContain('client_id=client-abc');

    const args = client.oauthUrl.mock.calls[0][0];
    expect(args.clientId).toBe('client-abc');
    expect(args.redirectUri).toBe('https://ten.example/api/v2/linkedin/oauth/callback');
    expect(args.scopes).toEqual(client.DEFAULT_SCOPES);
    /* A random state, long enough to be unguessable, is what makes the
       callback's cross-site check worth anything. */
    expect(args.state).toMatch(/^[a-f0-9]{32}$/);
  });

  it('is 403 for a mentor, who may use the agent but may not connect the page', async () => {
    process.env.LINKEDIN_CLIENT_ID = 'client-abc';
    process.env.LINKEDIN_REDIRECT_URI = 'https://ten.example/cb';
    for (const role of ['mentor', 'coordinator', 'founder']) {
      const res = await get('/oauth/start', role);
      expect(res.status).toBe(403);
    }
    expect((await get('/oauth/start', 'admin')).status).toBe(302);
    expect(client.oauthUrl).toHaveBeenCalledTimes(1);
  });

  it('refuses a callback whose state was never issued here', async () => {
    process.env.LINKEDIN_CLIENT_ID = 'client-abc';
    process.env.LINKEDIN_CLIENT_SECRET = 'shh';
    process.env.LINKEDIN_REDIRECT_URI = 'https://ten.example/cb';
    const res = await get('/oauth/callback?code=abc&state=forged', 'hr');
    expect(res.status).toBe(400);
    expect(client.exchangeCode).not.toHaveBeenCalled();
  });
});

describe('routes/v2/linkedinAgent — GET /stats', () => {
  it('says so when LinkedIn is not connected, and passes the numbers through when it is', async () => {
    client.config.mockReturnValue({ configured: false, orgUrn: '', apiVersion: '202609', source: 'none' });
    const off = await get('/stats', 'hr');
    expect(off.status).toBe(200);
    expect(off.body).toEqual({ ok: false, reason: 'LinkedIn is not connected on this server.' });
    expect(client.shareStatistics).not.toHaveBeenCalled();

    client.config.mockReturnValue(Object.assign({}, CONNECTED_CONFIG));
    client.shareStatistics.mockResolvedValue({ elements: [{ totalShareStatistics: { impressionCount: 42 } }] });
    const on = await get('/stats', 'hr');
    expect(on.body.ok).toBe(true);
    expect(on.body.stats.elements[0].totalShareStatistics.impressionCount).toBe(42);
    expect(client.shareStatistics).toHaveBeenCalledWith({ orgUrn: 'urn:li:organization:12345' });
  });
});
