'use strict';

/**
 * @jest-environment node
 *
 * The idea agent proposes and stops.
 *
 * Two things here are worth pinning. The first is the spend: the agent calls a
 * paid model on a timer, and the difference between a twice-daily expression
 * and a once-a-minute one is a single character and 1,438 extra calls a day.
 * The second is that
 * it must never act on its own output — the brief asked for an agent that
 * builds and deploys websites, and what shipped proposes only, behind a human
 * review step.
 *
 * The sandbox has no MongoDB, so the model is stubbed and the storage layer is
 * asserted on source, the pattern the rest of this suite uses.
 */

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '../..');
const agentSrc  = fs.readFileSync(path.join(root, 'services/ideaAgent.js'), 'utf8');
const serverJs  = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const adminSrc  = fs.readFileSync(path.join(root, 'routes/adminPortal.js'), 'utf8');
const modelSrc  = fs.readFileSync(path.join(root, 'models/AgentIdea.js'), 'utf8');

const agent = require('../../services/ideaAgent');

describe('the agent proposes and does not act', () => {
  it('nothing in it deploys, publishes or sends', () => {
    // Guards the line the brief and the implementation disagree on. If a build
    // step is ever added it must go behind an approved row, not in here.
    const code = agentSrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(code).not.toMatch(/\b(exec|execSync|spawn|spawnSync)\s*\(/);
    expect(code).not.toMatch(/nodemailer|sendMail|createTransport/);
    expect(code).not.toMatch(/\bwrangler\b|\bdeploy\b/i);
  });

  it('rows land as pending_review, never approved', () => {
    expect(agentSrc).toMatch(/status:\s*'pending_review'/);
    expect(agentSrc).not.toMatch(/status:\s*'approved'/);
    // The schema default must agree with what the agent writes.
    expect(modelSrc).toMatch(/default:\s*'pending_review'/);
  });

  it('only a reviewer can move an idea on, and only once', () => {
    expect(adminSrc).toMatch(/router\.post\('\/ideas\/:id\/:action', requireAdminAPI/);
    // A second approval of the same row must not silently re-stamp it.
    expect(adminSrc).toMatch(/idea\.status !== 'pending_review'/);
  });
});

describe('the spend has a ceiling that is not the cron expression', () => {
  it('a daily cap exists and is small', () => {
    expect(typeof agent.MAX_IDEAS_PER_DAY).toBe('number');
    expect(agent.MAX_IDEAS_PER_DAY).toBeGreaterThan(0);
    expect(agent.MAX_IDEAS_PER_DAY).toBeLessThanOrEqual(50);
  });

  it('a run stops at the cap instead of calling the model', async () => {
    // The cap is checked BEFORE the model call, so hitting it costs nothing.
    jest.resetModules();
    jest.doMock('../../utils/gemini', () => ({
      ready: () => true,
      ask: jest.fn(async () => { throw new Error('the model must not be called'); }),
      Type: { OBJECT: 'OBJECT', ARRAY: 'ARRAY', STRING: 'STRING', BOOLEAN: 'BOOLEAN', INTEGER: 'INTEGER' },
      GEMINI_MODEL: () => 'test-model'
    }));
    jest.doMock('../../models/AgentIdea', () => ({
      countDocuments: async () => 999,          // already over the cap
      insertMany: async () => { throw new Error('must not write'); }
    }));
    const fresh = require('../../services/ideaAgent');
    const out = await fresh.runOnce();
    expect(out).toMatchObject({ ok: false, reason: 'daily-cap', stored: 0 });
    jest.dontMock('../../utils/gemini');
    jest.dontMock('../../models/AgentIdea');
  });

  it('a run never writes more rows than the cap leaves room for', async () => {
    jest.resetModules();
    const written = [];
    // One short of the cap: exactly one row may be stored, however many the
    // model returns.
    jest.doMock('../../utils/gemini', () => ({
      ready: () => true,
      ask: async () => ({
        ideas: [
          { title: 'a', summary: 's' }, { title: 'b', summary: 's' },
          { title: 'c', summary: 's' }, { title: 'd', summary: 's' }
        ]
      }),
      Type: { OBJECT: 'OBJECT', ARRAY: 'ARRAY', STRING: 'STRING', BOOLEAN: 'BOOLEAN', INTEGER: 'INTEGER' },
      GEMINI_MODEL: () => 'test-model'
    }));
    jest.doMock('../../models/AgentIdea', () => ({
      countDocuments: async () => agent.MAX_IDEAS_PER_DAY - 1,
      insertMany: async (rows) => { written.push(...rows); return rows; }
    }));
    const fresh = require('../../services/ideaAgent');
    const out = await fresh.runOnce();
    expect(out.stored).toBe(1);
    expect(written).toHaveLength(1);
    jest.dontMock('../../utils/gemini');
    jest.dontMock('../../models/AgentIdea');
  });

  it('a model failure is reported, not thrown at the scheduler', async () => {
    // A cron callback has no caller. An unhandled rejection here takes the
    // whole server down, so runOnce() must resolve even when Gemini is down.
    jest.resetModules();
    jest.doMock('../../utils/gemini', () => ({
      ready: () => true,
      ask: async () => { throw new Error('Gemini returned 503: busy'); },
      Type: { OBJECT: 'OBJECT', ARRAY: 'ARRAY', STRING: 'STRING', BOOLEAN: 'BOOLEAN', INTEGER: 'INTEGER' },
      GEMINI_MODEL: () => 'test-model'
    }));
    jest.doMock('../../models/AgentIdea', () => ({
      countDocuments: async () => 0,
      insertMany: async () => { throw new Error('must not write'); }
    }));
    const fresh = require('../../services/ideaAgent');
    await expect(fresh.runOnce()).resolves.toMatchObject({ ok: false, reason: 'model-failed' });
    jest.dontMock('../../utils/gemini');
    jest.dontMock('../../models/AgentIdea');
  });
});

describe('scheduling cannot quietly multiply', () => {
  it('it is off unless switched on', () => {
    delete process.env.IDEA_AGENT_ENABLED;
    expect(agent.initIdeaAgent()).toMatchObject({ started: false, reason: 'disabled' });
  });

  it('only PM2 worker 0 schedules it', () => {
    // Every worker runs server.js. Without this guard, four workers mean four
    // model calls and four sets of duplicate rows for one scheduled slot —
    // the same trap services/automationCron.js documents.
    expect(agentSrc).toMatch(/NODE_APP_INSTANCE/);
    expect(agentSrc).toMatch(/worker === undefined \|\| worker === '0'/);
  });

  it('a malformed cron expression is refused, not scheduled', () => {
    process.env.IDEA_AGENT_ENABLED = 'true';
    process.env.GEMINI_API_KEY = 'test-key';
    process.env.IDEA_AGENT_CRON = 'not a cron';
    expect(agent.initIdeaAgent()).toMatchObject({ started: false, reason: 'bad-cron' });
    delete process.env.IDEA_AGENT_ENABLED;
    delete process.env.GEMINI_API_KEY;
    delete process.env.IDEA_AGENT_CRON;
  });

  it('server.js starts it where the other scheduled jobs start', () => {
    expect(serverJs).toMatch(/require\("\.\/services\/ideaAgent"\)\.initIdeaAgent\(\)/);
  });
});

describe('one Gemini client, not two', () => {
  it('the agent uses the shared client', () => {
    expect(agentSrc).toMatch(/require\('\.\.\/utils\/gemini'\)/);
    // A second HTTPS client would mean a second retry policy and a second
    // place to edit when Google retires a model.
    expect(agentSrc).not.toMatch(/require\('https'\)/);
    expect(agentSrc).not.toMatch(/generativelanguage/);
  });

  it('the exam uses it too', () => {
    const exam = fs.readFileSync(path.join(root, 'services/learnExam.js'), 'utf8');
    expect(exam).toMatch(/require\('\.\.\/utils\/gemini'\)/);
  });
});

describe('model output reaching the admin page is escaped', () => {
  const adminPage = fs.readFileSync(path.join(root, 'public/ten-admin.html'), 'utf8');

  it('every idea field goes through escIdea before innerHTML', () => {
    // This is the one place in the portal where the rendered text was written
    // by a language model rather than a person or our own code. The rest of
    // this page interpolates raw, which is fine for rows we wrote; it is not
    // fine here.
    expect(adminPage).toMatch(/function escIdea\(/);
    for (const field of ['title', 'summary', 'forWhom', 'whyNow', 'effort', 'status', 'model']) {
      expect(adminPage).toMatch(new RegExp(`escIdea\\(i\\.${field}`));
    }
  });

  it('escIdea covers the characters that break out of HTML', () => {
    // Pull the function out of the page and run it, rather than trusting that
    // a regex match means it is correct.
    const at = adminPage.indexOf('function escIdea(');
    const body = adminPage.slice(at, adminPage.indexOf('\n}', at) + 2);
    // eslint-disable-next-line no-new-func
    const escIdea = new Function(body + '; return escIdea;')();

    expect(escIdea('<script>alert(1)</script>'))
      .toBe('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(escIdea('" onerror="x')).toBe('&quot; onerror=&quot;x');
    expect(escIdea("it's")).toBe('it&#39;s');
    expect(escIdea('a & b')).toBe('a &amp; b');
    expect(escIdea(null)).toBe('');
    expect(escIdea(undefined)).toBe('');
  });
});
