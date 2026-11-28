'use strict';

/**
 * Recruiter contacts the employers published.
 *
 * An address behind a link ("send your CV to <a href=mailto:…>our team</a>")
 * used to vanish when the tags came off; it reaches the recruiter table now.
 * Every address's domain is checked to receive mail before it is shown, and
 * the student's college is read for the "alumni at this company" search.
 */

process.env.JOB_CACHE_PATH = require('path').join(require('os').tmpdir(), `job-contacts-test-${process.pid}.json`);
jest.mock('../../services/v2/jobStore', () => ({ save: jest.fn(async (r) => r.length), find: jest.fn(async () => []) }));
jest.mock('../../services/collegeDiscovery', () => ({ hasMx: jest.fn() }));
const { hasMx } = require('../../services/collegeDiscovery');
const express = require('express');
const request = require('supertest');

const today = new Date().toISOString();
const realFetch = globalThis.fetch;
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const POSTING = {
  title: 'Frontend Developer', company_name: 'Kite', candidate_required_location: 'India', job_type: 'full_time',
  url: 'https://jobs.lever.co/kite/1', tags: ['react'], publication_date: today,
  description: '<p>Frontend Developer, React.</p><p>Send your CV to <a href="mailto:careers@kite.in?subject=CV">our hiring team</a>.</p>'
    + '<p>Or write to <a href="mailto:jobs@nowhere-kite.example">the old desk</a>.</p>',
};

beforeEach(() => {
  hasMx.mockReset().mockImplementation(async (d) => d === 'kite.in');
  globalThis.fetch = jest.fn(async (url, init) => {
    if ((init && init.method) === 'HEAD') return new Response('', { status: 200 });
    if (new URL(String(url)).hostname === 'remotive.com') return json({ jobs: [POSTING] });
    return json({}, 404);
  });
});
afterEach(() => {
  globalThis.fetch = realFetch;
  try { require('fs').unlinkSync(process.env.JOB_CACHE_PATH); } catch (e) { /* none written */ }
});

const agent = () => require('../../routes/v2/jobAgent');
const app = () => { const a = express(); a.use(express.json()); a.use('/api/v2/jobs', agent()); return a; };
const RESUME = 'Asha K\nFrontend developer\nasha@example.com\nSkills: JavaScript, React, HTML, CSS\nEDUCATION\nB.Tech, Kalinga Institute of Industrial Technology, 2021 - 2025';

describe('an address behind a link', () => {
  it('stays in the posting text beside its words', async () => {
    const { rows } = await agent().fetchOpenings({ role: 'frontend developer', skills: [], location: 'india' });
    const row = rows.find((r) => r.source === 'Remotive');
    expect(row.description).toMatch(/our hiring team \(careers@kite\.in\)/);
  });

  it('keeps a web link whole, so an apply link with a query string still works, and drops "#" links', async () => {
    const withLinks = { ...POSTING, description: '<p>Frontend Developer, React. <a href="https://boards.greenhouse.io/kite/jobs/77?gh_src=ten&amp;t=1">Apply here</a> <a href="#top">Back to top</a></p>' };
    globalThis.fetch.mockImplementation(async (url, init) => ((init && init.method) === 'HEAD' ? new Response('', { status: 200 })
      : new URL(String(url)).hostname === 'remotive.com' ? json({ jobs: [withLinks] }) : json({}, 404)));
    const { rows } = await agent().fetchOpenings({ role: 'frontend developer', skills: [], location: 'india' });
    const row = rows.find((r) => r.source === 'Remotive');
    expect(row.description).toContain('Apply here (https://boards.greenhouse.io/kite/jobs/77?gh_src=ten&t=1)');
    expect(row.description).not.toContain('#top');
    expect(require('../../services/v2/jobDirectLink').extractApplyLink(row.description, row.url))
      .toEqual({ url: 'https://boards.greenhouse.io/kite/jobs/77?gh_src=ten&t=1', kind: 'ats' });
  });

  it('reaches the recruiter table, checked to receive mail, and a dead domain does not', async () => {
    const res = await request(app()).post('/api/v2/jobs/search').field('text', RESUME);
    expect(res.body.ok).toBe(true);
    const emails = res.body.recruiters.map((r) => r.email);
    expect(emails).toContain('careers@kite.in');
    expect(emails).not.toContain('jobs@nowhere-kite.example');
    const kite = res.body.recruiters.find((r) => r.email === 'careers@kite.in');
    expect(kite).toMatchObject({ mailChecked: true, sourceUrl: 'https://jobs.lever.co/kite/1' });
  });

  it('keeps a contact when the mail check is only slow', async () => {
    jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick', 'queueMicrotask'] });
    hasMx.mockImplementation(() => new Promise(() => {}));
    const pending = request(app()).post('/api/v2/jobs/search').field('text', RESUME);
    const done = pending.then((r) => r);
    for (let i = 0; i < 20; i += 1) { await new Promise((r) => setImmediate(r)); jest.advanceTimersByTime(3000); }
    const res = await done;
    jest.useRealTimers();
    const kite = res.body.recruiters.find((r) => r.email === 'careers@kite.in');
    expect(kite).toBeTruthy();
    expect(kite.mailChecked).toBeUndefined();   // kept, but not claimed as checked
  });

  it('keeps a contact when the resolver fails, and does not call it checked', async () => {
    hasMx.mockImplementation(async (d, opts) => opts.unknown);   // what hasMx answers on a SERVFAIL
    const res = await request(app()).post('/api/v2/jobs/search').field('text', RESUME);
    const emails = res.body.recruiters.map((r) => r.email);
    expect(emails).toEqual(expect.arrayContaining(['careers@kite.in', 'jobs@nowhere-kite.example']));
    expect(res.body.recruiters.every((r) => r.mailChecked === undefined)).toBe(true);
  });
});

describe('the college, for the alumni search', () => {
  it.each([
    ['A\nDev\nEDUCATION\nB.Tech Computer Science, Kalinga Institute of Industrial Technology, 2021 - 2025', 'Kalinga Institute of Industrial Technology'],
    ['B\nDev\nKIIT University (2022 - 2026)', 'KIIT University'],
    ['C\nDev\nIIT Bombay | B.Tech | 2020-2024', 'IIT Bombay'],
    ['D\nDev\nSKILLS\nJava', ''],
  ])('%#', (text, college) => {
    expect(agent().profileFromResume(text).college).toBe(college);
  });
});
