'use strict';

/**
 * The Founder OS.
 *
 * The portal behind "Hire our interns" did nothing, for two reasons that
 * compound:
 *
 *   1. routes/founderOS.js had two endpoints — a page and a stats blob — so
 *      there was nothing for a founder to do even in principle.
 *   2. Every route in the app behind requireRole() answered 401, because
 *      attachEcosystemUser (the only thing that sets req.user) was written,
 *      exported, unit-tested and never mounted. A correctly signed-in founder
 *      was told "Authentication required."
 *
 * So this pins both: that the middleware is actually mounted, and that the API
 * behind the new page works and is scoped to the founder who is asking.
 *
 * The thing most worth pinning is the scoping. A deal room, a cap table and a
 * hiring pipeline are the most confidential things in this product; if any
 * route took a founderId from the request rather than the session, one founder
 * could read another's.
 */

const fs = require('fs');
const path = require('path');
const express = require('express');
const request = require('supertest');

const root = path.join(__dirname, '../..');

/* ── the mounted-middleware bug ─────────────────────────────────────────── */

describe('attachEcosystemUser is actually mounted', () => {
  const source = fs.readFileSync(path.join(root, 'server.js'), 'utf8');

  it('runs on every request, right after the session', () => {
    // Without this line, req.user is undefined for everyone and requireRole
    // refuses every founder, mentor, investor and contractor route in the app.
    expect(source).toMatch(/app\.use\(attachEcosystemUser\)/);
  });

  it('is mounted after the session middleware, not before', () => {
    const session = source.indexOf('app.use(sessionMiddleware)');
    const attach = source.indexOf('app.use(attachEcosystemUser)');
    expect(session).toBeGreaterThan(-1);
    expect(attach).toBeGreaterThan(session);
  });
});

/* ── the API ────────────────────────────────────────────────────────────── */

const FOUNDER_A = '507f1f77bcf86cd799439011';
const FOUNDER_B = '507f1f77bcf86cd799439012';

/** Rows the fake models hand back, keyed by collection. */
const mockDb = { jobs: [], applications: [], rounds: [], docs: [], team: [], bookings: [], students: [] };

/** The filter each model was last queried with — this is what the scoping assertions read. */
const mockSeen = { jobs: null, applications: null, rounds: null, docs: null, team: null, bookings: null, students: null };

function chain(rows) {
  const o = {
    sort: () => o, skip: () => o, limit: () => o, select: () => o, lean: () => o,
    then: (r, j) => Promise.resolve(rows).then(r, j),
    catch: (j) => Promise.resolve(rows).catch(j)
  };
  return o;
}

/** A model just complete enough to drive the routes under test. */
function fakeModel(key) {
  return {
    find: (filter) => { mockSeen[key] = filter; return chain(mockDb[key].filter((r) => matches(r, filter))); },
    findOne: (filter) => {
      mockSeen[key] = filter;
      return chain(mockDb[key].find((r) => matches(r, filter)) || null);
    },
    findById: () => chain(mockDb[key][0] || null),
    findOneAndUpdate: (filter, update) => {
      mockSeen[key] = filter;
      const row = mockDb[key].find((r) => matches(r, filter));
      if (row) Object.assign(row, (update && update.$set) || {});
      return chain(row || null);
    },
    findOneAndDelete: (filter) => {
      mockSeen[key] = filter;
      const i = mockDb[key].findIndex((r) => matches(r, filter));
      return chain(i === -1 ? null : mockDb[key].splice(i, 1)[0]);
    },
    create: async (doc) => {
      const row = Object.assign({ _id: 'new-' + mockDb[key].length, toObject() { return this; } }, doc);
      mockDb[key].push(row);
      return row;
    },
    countDocuments: async (filter) => mockDb[key].filter((r) => matches(r, filter)).length,
    updateOne: async () => ({}),
    updateMany: async () => ({}),
    deleteMany: async () => ({}),
    aggregate: async () => []
  };
}

/** Only the operators these routes actually use. */
function matches(row, filter) {
  if (!filter) return true;
  return Object.keys(filter).every((k) => {
    if (k === '$or') return true;
    const want = filter[k];
    if (want && typeof want === 'object' && '$in' in want) return want.$in.some((v) => String(v) === String(row[k]));
    if (want && typeof want === 'object' && '$gte' in want) return Number(row[k]) >= want.$gte;
    if (want && typeof want === 'object' && '$ne' in want) return row[k] !== want.$ne;
    return String(row[k]) === String(want);
  });
}

jest.mock('../../models/founderOS', () => {
  const stages = ['applied', 'shortlisted', 'interview', 'offer', 'hired', 'rejected'];
  const invStages = ['researching', 'contacted', 'meeting', 'diligence', 'committed', 'passed'];
  return {
    JobPost: global.__mkModel('jobs'),
    JobApplication: global.__mkModel('applications'),
    FundraisingRound: global.__mkModel('rounds'),
    DataRoomDocument: global.__mkModel('docs'),
    StartupTeamMember: global.__mkModel('team'),
    MentorBooking: global.__mkModel('bookings'),
    APPLICATION_STAGES: stages,
    INVESTOR_STAGES: invStages
  };
});

jest.mock('../../models/Student', () => global.__mkModel('students'));
jest.mock('../../models/Payment', () => ({ aggregate: async () => [] }));
jest.mock('../../models/MentorProfile', () => ({ find: () => global.__chain([]), countDocuments: async () => 0 }));
jest.mock('../../models/FounderProfile', () => ({
  findOne: () => global.__chain({ startupName: 'Kite Labs' }),
  findOneAndUpdate: (f, u) => global.__chain(Object.assign({ userId: f.userId }, u.$set)),
  countDocuments: async () => 0
}));
jest.mock('../../models/InvestorProfile', () => ({ find: () => global.__chain([]), countDocuments: async () => 0 }));
jest.mock('../../models/StartupProfile', () => ({
  findOne: () => global.__chain({ startupName: 'Kite Labs', industry: 'Logistics' }),
  findOneAndUpdate: (f, u) => global.__chain(Object.assign({ founderId: f.founderId }, u.$set))
}));
jest.mock('../../models/EcosystemUser', () => ({
  findById: () => global.__chain({ _id: 'x', fullName: 'Meera Iyer', role: 'founder' }),
  find: () => global.__chain([])
}));

global.__mkModel = fakeModel;
global.__chain = chain;

const founderRouter = require('../../routes/founderOS');

function appAs(user) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = user; next(); });
  app.use('/api/founder-os', founderRouter);
  return app;
}

const asFounder = () => request(appAs({ _id: FOUNDER_A, role: 'founder' }));
const asStudent = () => request(appAs({ _id: 'someone', role: 'student' }));
const asNobody = () => request(appAs(undefined));

beforeEach(() => {
  Object.keys(mockDb).forEach((k) => { mockDb[k] = []; });
  Object.keys(mockSeen).forEach((k) => { mockSeen[k] = null; });
});

describe('who is allowed in', () => {
  it('refuses a request with no session', async () => {
    const res = await asNobody().get('/api/founder-os/jobs');
    expect(res.status).toBe(401);
  });

  it('refuses a signed-in student', async () => {
    // A student holds a perfectly valid session. It is not a founder session.
    const res = await asStudent().get('/api/founder-os/rounds');
    expect(res.status).toBe(403);
    expect(res.body.yourRole).toBe('student');
  });

  it('lets a founder in', async () => {
    const res = await asFounder().get('/api/founder-os/jobs');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

describe('one founder cannot reach another founder\'s workspace', () => {
  it('scopes every list to the session founder', async () => {
    await asFounder().get('/api/founder-os/jobs');
    expect(String(mockSeen.jobs.founderId)).toBe(FOUNDER_A);

    await asFounder().get('/api/founder-os/rounds');
    expect(String(mockSeen.rounds.founderId)).toBe(FOUNDER_A);

    await asFounder().get('/api/founder-os/dataroom');
    expect(String(mockSeen.docs.founderId)).toBe(FOUNDER_A);

    await asFounder().get('/api/founder-os/team');
    expect(String(mockSeen.team.founderId)).toBe(FOUNDER_A);
  });

  it('ignores a founderId supplied in the query', async () => {
    // The deal room is the most confidential thing in the product. Reading it
    // must not be a matter of naming somebody else's id.
    await asFounder().get('/api/founder-os/rounds?founderId=' + FOUNDER_B);
    expect(String(mockSeen.rounds.founderId)).toBe(FOUNDER_A);
  });

  it('ignores a founderId supplied in the body', async () => {
    mockDb.jobs.push({ _id: 'j1', founderId: FOUNDER_A, title: 'Intern' });
    await asFounder().put('/api/founder-os/jobs/j1').send({ title: 'Changed', founderId: FOUNDER_B });
    expect(String(mockSeen.jobs.founderId)).toBe(FOUNDER_A);
    expect(mockDb.jobs[0].founderId).toBe(FOUNDER_A);
  });

  it('answers 404, not 403, for another founder\'s document', async () => {
    // Scoping by founderId in the query means a foreign id simply does not
    // match — which is also the right answer to give, since 403 would confirm
    // the document exists.
    mockDb.rounds.push({ _id: 'r1', founderId: FOUNDER_B, name: 'Someone else\'s seed' });
    const res = await asFounder().put('/api/founder-os/rounds/r1').send({ name: 'Mine now' });
    expect(res.status).toBe(404);
    expect(mockDb.rounds[0].name).toBe('Someone else\'s seed');
  });
});

describe('the hiring pipeline', () => {
  it('refuses a stage that is not a stage', async () => {
    mockDb.applications.push({ _id: 'a1', founderId: FOUNDER_A, stage: 'applied', history: [], save: async () => {}, toObject() { return this; } });
    const res = await asFounder().post('/api/founder-os/applications/a1/stage').send({ stage: 'promoted' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Unknown stage/);
  });

  it('records every move, so "how long has this been in interview" is answerable', async () => {
    const app = { _id: 'a1', founderId: FOUNDER_A, stage: 'applied', name: 'Anmol',
      history: [], save: async () => {}, toObject() { return this; } };
    mockDb.applications.push(app);

    await asFounder().post('/api/founder-os/applications/a1/stage').send({ stage: 'interview', note: 'Strong take-home' });
    expect(app.stage).toBe('interview');
    expect(app.history).toHaveLength(1);
    expect(app.history[0]).toMatchObject({ from: 'applied', to: 'interview', note: 'Strong take-home' });
  });

  it('adds a hire to the team roster', async () => {
    // The step everybody forgets by hand, which is how a team page goes stale.
    const app = { _id: 'a1', founderId: FOUNDER_A, stage: 'offer', name: 'Anmol', email: 'a@x.com',
      history: [], save: async () => {}, toObject() { return this; } };
    mockDb.applications.push(app);

    await asFounder().post('/api/founder-os/applications/a1/stage').send({ stage: 'hired' });
    expect(mockDb.team).toHaveLength(1);
    expect(mockDb.team[0]).toMatchObject({ founderId: FOUNDER_A, name: 'Anmol', fromApplicationId: 'a1' });
  });

  it('does not add the same hire twice', async () => {
    const app = { _id: 'a1', founderId: FOUNDER_A, stage: 'offer', name: 'Anmol',
      history: [], save: async () => {}, toObject() { return this; } };
    mockDb.applications.push(app);
    mockDb.team.push({ _id: 't1', founderId: FOUNDER_A, fromApplicationId: 'a1', name: 'Anmol' });

    await asFounder().post('/api/founder-os/applications/a1/stage').send({ stage: 'hired' });
    expect(mockDb.team).toHaveLength(1);
  });
});

describe('talent search does not hand a founder a contact list', () => {
  const source = fs.readFileSync(path.join(root, 'routes/founderOS.js'), 'utf8');

  it('projects an allowlist rather than excluding a few fields', () => {
    // `.select('-password')` returns everything else, which on this schema is
    // the email, the phone number, the college and the home address.
    const at = source.indexOf('const TALENT_FIELDS');
    expect(at).toBeGreaterThan(-1);
    const line = source.slice(at, source.indexOf(';', at));
    expect(line).not.toMatch(/-password/);
    ['email', 'whatsapp', 'phone', 'college', 'address', 'plainPassword'].forEach((f) => {
      expect(line).not.toContain(f);
    });
  });

  it('asks the database for that projection, not for whole documents', async () => {
    await asFounder().get('/api/founder-os/talent?domain=Web%20Development');
    expect(String(mockSeen.students.domain)).toBe('Web Development');
  });
});

describe('fundraising arithmetic', () => {
  it('derives committed capital from the commitments, not a typed number', async () => {
    // A round total typed in one place and commitments recorded in another is
    // two numbers that will disagree by Friday.
    const round = {
      _id: 'r1', founderId: FOUNDER_A, raisedAmount: 999,
      investors: [
        { _id: 'i1', name: 'Asha', stage: 'committed', committed: true, checkSize: 500000 },
        { _id: 'i2', name: 'Blue', stage: 'meeting', committed: false, checkSize: 900000 }
      ],
      save: async () => {}, toObject() { return this; }
    };
    round.investors.id = (id) => round.investors.find((i) => i._id === id);
    mockDb.rounds.push(round);

    await asFounder().post('/api/founder-os/rounds/r1/investors')
      .send({ investorId: 'i2', stage: 'committed' });

    expect(round.investors[1].committed).toBe(true);
    expect(round.raisedAmount).toBe(1400000);
  });

  it('refuses an investor stage that is not a stage', async () => {
    const round = { _id: 'r1', founderId: FOUNDER_A, investors: [], save: async () => {}, toObject() { return this; } };
    round.investors.id = () => ({ });
    mockDb.rounds.push(round);
    const res = await asFounder().post('/api/founder-os/rounds/r1/investors')
      .send({ investorId: 'i1', stage: 'signed' });
    expect(res.status).toBe(400);
  });
});

describe('the data room defaults to private', () => {
  it('stores anything not explicitly shared as private', async () => {
    // A cap table shared by accident is not recoverable.
    await asFounder().post('/api/founder-os/dataroom').send({ title: 'Cap table' });
    expect(mockDb.docs[0].visibility).toBe('private');

    await asFounder().post('/api/founder-os/dataroom').send({ title: 'Deck', visibility: 'yes please' });
    expect(mockDb.docs[1].visibility).toBe('private');

    await asFounder().post('/api/founder-os/dataroom').send({ title: 'Deck', visibility: 'shared' });
    expect(mockDb.docs[2].visibility).toBe('shared');
  });
});

describe('mentor bookings', () => {
  it('refuses a session in the past', async () => {
    const res = await asFounder().post('/api/founder-os/bookings')
      .send({ mentorId: 'm1', topic: 'Pricing', requestedFor: '2001-01-01T10:00:00Z' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/already passed/);
  });

  it('refuses a date it cannot read', async () => {
    const res = await asFounder().post('/api/founder-os/bookings')
      .send({ mentorId: 'm1', topic: 'Pricing', requestedFor: 'next tuesday' });
    expect(res.status).toBe(400);
  });

  it('accepts one in the future and scopes it to the founder', async () => {
    const when = new Date(Date.now() + 86400000).toISOString();
    const res = await asFounder().post('/api/founder-os/bookings')
      .send({ mentorId: 'm1', topic: 'Pricing', requestedFor: when, durationMins: 45 });
    expect(res.status).toBe(200);
    expect(mockDb.bookings[0]).toMatchObject({ founderId: FOUNDER_A, mentorId: 'm1', durationMins: 45 });
  });

  it('clamps an absurd duration rather than storing it', async () => {
    const when = new Date(Date.now() + 86400000).toISOString();
    await asFounder().post('/api/founder-os/bookings')
      .send({ mentorId: 'm1', topic: 'x', requestedFor: when, durationMins: 100000 });
    expect(mockDb.bookings[0].durationMins).toBe(180);
  });
});

describe('analytics answer about this startup, not about the platform', () => {
  it('counts the founder\'s own rows', async () => {
    mockDb.jobs.push({ _id: 'j1', founderId: FOUNDER_A, status: 'open' },
                     { _id: 'j2', founderId: FOUNDER_A, status: 'closed' });
    mockDb.applications.push({ founderId: FOUNDER_A, stage: 'applied', domain: 'Web Development' },
                             { founderId: FOUNDER_A, stage: 'hired', domain: 'Web Development' });
    mockDb.team.push({ founderId: FOUNDER_A, status: 'active', equity: 10 });

    const res = await asFounder().get('/api/founder-os/analytics');
    expect(res.body.hiring).toMatchObject({ jobsOpen: 1, jobsTotal: 2, applications: 2, hired: 1, conversionPct: 50 });
    expect(res.body.hiring.byDomain).toEqual({ 'Web Development': 2 });
    expect(res.body.team).toMatchObject({ total: 1, equityAllocated: 10 });
  });

  it('does not divide by zero on an empty workspace', async () => {
    const res = await asFounder().get('/api/founder-os/analytics');
    expect(res.body.hiring.conversionPct).toBe(0);
    expect(res.body.fundraising.progressPct).toBe(0);
  });
});

/* ── the page ───────────────────────────────────────────────────────────── */

describe('the page it serves', () => {
  const page = fs.readFileSync(path.join(root, 'public/founder-os.html'), 'utf8');

  it('is no longer a duplicate of talent-network.html', () => {
    // Both files were 2,020 lines with the same <title>, rendering placeholder
    // data from a two-endpoint API.
    expect(page).not.toContain('TEN Platform — Unified Operating System');
    expect(page).toContain('<title>Founder OS — TEN</title>');
  });

  it('carries every section the founder scope asked for', () => {
    ['profile', 'jobs', 'pipeline', 'talent', 'fundraising', 'dataroom', 'team', 'mentors'].forEach((v) => {
      expect(page).toContain('id="v-' + v + '"');
      expect(page).toContain('data-v="' + v + '"');
    });
  });

  it('never sends a founderId of its own', () => {
    // The server ignores one, but a page that sends it implies a trust model
    // that does not exist.
    expect(page).not.toMatch(/founderId:\s*[A-Za-z]/);
    expect(page).not.toContain('?founderId=');
  });

  it('escapes everything it renders', () => {
    // Job titles, candidate names and investor names are all typed by someone.
    expect(page).toContain('function esc(');
    expect(page).toContain(".replace(/</g,'&lt;')");
    expect(page).toContain('esc(j.title)');
    expect(page).toContain('esc(a.name');
  });

  it('does not load a framework from a CDN to render a logged-in page', () => {
    // Assert on the tag, not on the hostname: the page's own comment explains
    // why the Tailwind CDN was dropped, and a substring match on the host
    // matches the explanation as readily as a reintroduced script tag.
    const scripts = page.match(/<script[^>]*src="[^"]*"/g) || [];
    scripts.forEach((s) => {
      expect(s).not.toMatch(/cdn\.tailwindcss\.com|unpkg\.com|cdnjs\./);
    });
  });

  it('sends a 401 to the login page rather than showing empty panels', () => {
    expect(page).toContain("res.status === 401");
    expect(page).toContain("/founder-login");
  });
});

describe('the home page sends employers to it', () => {
  const home = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');

  it('points "Hire our interns" at the founder portal', () => {
    expect(home).toContain('href="/founder-os"');
    expect(home).not.toContain('talent-network.html');
  });
});
