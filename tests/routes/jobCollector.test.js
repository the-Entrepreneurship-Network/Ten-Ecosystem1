'use strict';

/**
 * The job collector and the shelf a search reads.
 *
 * A search used to hunt every board live, up to half a minute per click. The
 * collector does that in the background, with Adzuna and Jooble added for
 * Indian openings, and a search answers from the stored rows when there are
 * enough of them.
 */

/* The agent's older memory file is per test run, never the repository's data/. */
process.env.JOB_CACHE_PATH = require('path').join(require('os').tmpdir(), `job-cache-test-${process.pid}.json`);
jest.mock('../../services/v2/jobStore', () => ({ save: jest.fn(), find: jest.fn() }));
const jobStore = require('../../services/v2/jobStore');
const express = require('express');
const request = require('supertest');

const today = new Date().toISOString();
let calls;
const realFetch = globalThis.fetch;
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

beforeEach(() => {
  calls = [];
  process.env.ADZUNA_APP_ID = 'id1';
  process.env.ADZUNA_APP_KEY = 'key1';
  process.env.JOOBLE_API_KEY = 'jk1';
  jobStore.save.mockReset().mockImplementation(async (rows) => rows.length);
  jobStore.find.mockReset().mockResolvedValue([]);
  globalThis.fetch = jest.fn(async (url, init) => {
    const u = new URL(String(url));
    calls.push({ host: u.hostname, url: String(url), method: (init && init.method) || 'GET', body: init && init.body });
    if ((init && init.method) === 'HEAD') return new Response('', { status: 200 });
    if (u.hostname === 'api.adzuna.com') {
      return json({ results: [{
        id: '1', title: 'Junior <b>Frontend</b> Developer', company: { display_name: 'Saffron Labs' },
        location: { display_name: 'Pune, Maharashtra' }, redirect_url: 'https://www.adzuna.in/land/ad/1',
        created: today, salary_min: 400000, salary_max: 600000, contract_time: 'full_time', description: 'React and CSS.',
      }] });
    }
    if (u.hostname === 'in.jooble.org') {
      return json({ totalCount: 1, jobs: [{ id: 9, title: 'Web Developer Intern', company: 'Kite', location: 'Bengaluru',
        snippet: 'HTML, CSS and JavaScript.', salary: '₹15,000 a month', type: 'Internship', link: 'https://in.jooble.org/desc/9', updated: today }] });
    }
    return json({ error: 'not here' }, 404);
  });
});
afterEach(() => {
  globalThis.fetch = realFetch;
  try { require('fs').unlinkSync(process.env.JOB_CACHE_PATH); } catch (e) { /* none written */ }
  ['ADZUNA_APP_ID', 'ADZUNA_APP_KEY', 'JOOBLE_API_KEY'].forEach((k) => delete process.env[k]);
});

const agent = () => require('../../routes/v2/jobAgent');

describe('the Indian sources', () => {
  it('reads Adzuna\'s India index and Jooble\'s Indian site, links labelled as theirs', async () => {
    const { rows } = await agent().fetchOpenings({ role: 'frontend developer', skills: [], location: 'pune' });
    const adzuna = rows.find((r) => r.source === 'Adzuna');
    expect(adzuna).toMatchObject({
      title: 'Junior Frontend Developer', company: 'Saffron Labs', location: 'Pune, Maharashtra',
      url: 'https://www.adzuna.in/land/ad/1', directUrl: 'https://www.adzuna.in/land/ad/1', directKind: 'via',
      salary: '₹4–6 lakh a year', type: 'full-time',
    });
    const az = calls.find((c) => c.host === 'api.adzuna.com').url;
    expect(az).toMatch(/\/v1\/api\/jobs\/in\/search\/1\?app_id=id1&app_key=key1/);
    expect(az).toMatch(/what=frontend%20developer/);
    expect(az).toMatch(/where=pune/);

    const jooble = rows.find((r) => r.source === 'Jooble');
    expect(jooble).toMatchObject({ title: 'Web Developer Intern', company: 'Kite', directKind: 'via', salary: '₹15,000 a month' });
    const jc = calls.find((c) => c.host === 'in.jooble.org');
    expect(jc.method).toBe('POST');
    expect(jc.url).toBe('https://in.jooble.org/api/jk1');
    expect(JSON.parse(jc.body)).toEqual({ keywords: 'frontend developer', location: 'pune' });
  });

  it('stays off, and calls nothing, without its keys', async () => {
    ['ADZUNA_APP_ID', 'ADZUNA_APP_KEY', 'JOOBLE_API_KEY'].forEach((k) => delete process.env[k]);
    await agent().fetchOpenings({ role: 'data analyst', skills: [], location: 'india' });
    expect(calls.some((c) => c.host === 'api.adzuna.com' || c.host === 'in.jooble.org')).toBe(false);
  });
});

describe('the collector', () => {
  it('searches every role once and stores only rows whose links were checked', async () => {
    const out = await agent().collectOnce();
    const { TITLE_HINTS_COUNT } = { TITLE_HINTS_COUNT: calls.filter((c) => c.host === 'api.adzuna.com').length };
    expect(TITLE_HINTS_COUNT).toBeGreaterThanOrEqual(15);
    const saved = jobStore.save.mock.calls.flatMap((c) => c[0]);
    expect(saved.some((r) => r.source === 'Adzuna')).toBe(true);
    expect(saved.some((r) => r.source === 'Jooble')).toBe(true);
    expect(out.counts.Adzuna).toBeGreaterThanOrEqual(15);
    /* "India" is not a city, so the role-wide runs do not narrow by it. */
    expect(calls.find((c) => c.host === 'api.adzuna.com').url).not.toMatch(/where=/);
  });

  it('runs once at a time', () => {
    const a = agent().collectOnce();
    const b = agent().collectOnce();
    expect(a).toBe(b);
    return a;
  });
});

describe('a search reads the shelf first', () => {
  const app = () => { const a = express(); a.use(express.json()); a.use('/api/v2/jobs', agent()); return a; };
  const RESUME = 'Asha K\nFrontend developer\nasha@example.com\nSkills: JavaScript, React, HTML, CSS';
  const shelf = Array.from({ length: 30 }, (_, i) => ({
    source: 'Lever', title: `Frontend Developer ${i}`, company: `Co${i}`, location: 'Bengaluru, India', type: 'Full-time',
    tags: ['react'], url: `https://jobs.lever.co/co${i}/1`, directUrl: `https://jobs.lever.co/co${i}/1`, directKind: 'ats',
    posted: today, description: 'React, JavaScript', fromStore: true,
  }));

  it('answers from stored openings without touching a board', async () => {
    jobStore.find.mockResolvedValue(shelf);
    const res = await request(app()).post('/api/v2/jobs/search').field('text', RESUME);
    expect(res.body.ok).toBe(true);
    expect(res.body.jobs.length).toBeGreaterThan(20);
    expect(res.body.sources[0].name).toMatch(/Saved openings/);
    expect(calls).toEqual([]);
  });

  it('hunts live when the shelf cannot answer', async () => {
    jobStore.find.mockResolvedValue(shelf.slice(0, 3));
    const res = await request(app()).post('/api/v2/jobs/search').field('text', RESUME);
    expect(res.body.ok).toBe(true);
    expect(calls.some((c) => c.host === 'api.adzuna.com')).toBe(true);
    /* Employer links lead, then the via-links. */
    const kinds = res.body.jobs.map((j) => (j.directKind === 'via' ? 'via' : 'own'));
    expect(kinds.indexOf('own')).toBeLessThan(Math.max(0, kinds.indexOf('via')) + (kinds.includes('via') ? 0 : 1));
  });
});
