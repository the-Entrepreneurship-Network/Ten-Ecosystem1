'use strict';

/**
 * The agent's memory of openings: what it keeps, what it refreshes, what it
 * forgets, and the property the outage exposed — remembered rows must come
 * back when the boards cannot.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const TMP = path.join(os.tmpdir(), `job-cache-test-${process.pid}.json`);
process.env.JOB_CACHE_PATH = TMP;

/* Required after the env var so the module binds to the test file. */
const cache = require('../../services/v2/jobCache');

const JOB = (over) => ({
  source: 'Remotive', title: 'Backend Developer', company: 'Acme',
  location: 'Remote', type: 'Remote', tags: ['java'],
  url: 'https://remotive.com/remote-jobs/dev/1', posted: new Date().toISOString(),
  description: 'Java and Spring', jobId: 'Remotive-Acme-BackendDevelope',
  ...over
});

describe('the job memory', () => {
  beforeEach(() => { try { fs.unlinkSync(TMP); } catch (e) { /* clean slate */ } });
  afterAll(() => { try { fs.unlinkSync(TMP); } catch (e) { /* tidy */ } });

  it('remembers a hunt and recalls it for the next one', () => {
    cache.remember([JOB()]);
    const back = cache.recall(new Set());
    expect(back).toHaveLength(1);
    expect(back[0].fromCache).toBe(true);
    expect(back[0].seenDaysAgo).toBe(0);
    expect(back[0].title).toBe('Backend Developer');
  });

  it('does not return rows the current hunt already found', () => {
    cache.remember([JOB()]);
    const excluded = cache.recall(new Set(['backend developer|acme']));
    expect(excluded).toHaveLength(0);
  });

  it('keeps a resolved direct link even when a later pass fails to resolve it', () => {
    cache.remember([JOB({ directUrl: 'https://boards.greenhouse.io/acme/jobs/1', directKind: 'ats' })]);
    cache.remember([JOB()]); /* same job, no directUrl this time */
    const back = cache.recall(new Set());
    expect(back[0].directUrl).toContain('greenhouse.io');
  });

  it('refreshes a known job instead of duplicating it', () => {
    cache.remember([JOB()]);
    cache.remember([JOB({ location: 'Remote, EU' })]);
    expect(cache.recall(new Set())).toHaveLength(1);
  });

  it('keeps a six-week-old opening and forgets a seven-month-old one', () => {
    cache.remember([JOB()]);
    const entries = JSON.parse(fs.readFileSync(TMP, 'utf8'));
    entries[0].fetchedAt = new Date(Date.now() - 42 * 86400000).toISOString();
    fs.writeFileSync(TMP, JSON.stringify(entries));
    expect(cache.recall(new Set())).toHaveLength(1); /* inside the window, aged honestly */

    entries[0].fetchedAt = new Date(Date.now() - 210 * 86400000).toISOString();
    fs.writeFileSync(TMP, JSON.stringify(entries));
    expect(cache.recall(new Set())).toHaveLength(0); /* presumed gone */
  });

  it('caps the memory rather than growing forever', () => {
    const many = Array.from({ length: 620 }, (_, i) => JOB({ title: `Role ${i}`, company: `Co ${i}` }));
    cache.remember(many);
    const entries = JSON.parse(fs.readFileSync(TMP, 'utf8'));
    expect(entries.length).toBeLessThanOrEqual(500);
  });

  it('survives a corrupt file as an empty memory, not a crash', () => {
    fs.writeFileSync(TMP, '{not json');
    expect(cache.recall(new Set())).toEqual([]);
    cache.remember([JOB()]);
    expect(cache.recall(new Set())).toHaveLength(1);
  });
});
