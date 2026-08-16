'use strict';

const agent = require('../../routes/v2/jobAgent');
const { profileFromResume, jobIdOf, isStale, xray } = agent;

describe('reading a resume', () => {
  const RESUME = [
    'Asha Menon',
    'asha@example.com · Bengaluru',
    '',
    'Experience',
    '2021 - present: Built a booking platform in React and Node.',
    'Wrote the MongoDB aggregation layer.',
    '',
    'Projects',
    'Created a TypeScript CLI that generates invoices.',
    '',
    'Education',
    'B.Tech Computer Science'
  ].join('\n');

  it('pulls the name off the top without dragging in the job title', () => {
    expect(profileFromResume(RESUME).name).toBe('Asha Menon');
  });

  it('finds the skills that are actually written down', () => {
    const skills = profileFromResume(RESUME).skills;
    expect(skills).toEqual(expect.arrayContaining(['react', 'node', 'mongodb', 'typescript']));
  });

  it('reads years of experience from an explicit statement first', () => {
    expect(profileFromResume('I have 6 years of experience in Java').years).toBe(6);
  });

  it('collects what was built, for judging project relevance', () => {
    const projects = profileFromResume(RESUME).projects;
    expect(projects.join(' ')).toMatch(/TypeScript CLI/);
  });

  it('notices a degree', () => {
    expect(profileFromResume(RESUME).education).toBeTruthy();
    expect(profileFromResume('no schooling listed here').education).toBeNull();
  });
});

describe('job identity and freshness', () => {
  it('prefers the id the board published', () => {
    expect(jobIdOf({ source: 'Remotive', url: 'https://remotive.com/remote-jobs/1234567', company: 'X', title: 'Y' }))
      .toMatch(/1234567/);
  });

  it('falls back to something stable and readable', () => {
    const id = jobIdOf({ source: 'HN Who is Hiring', url: 'https://news.ycombinator.com/item?id=1', company: 'Acme Ltd', title: 'Backend Engineer' });
    expect(id).toBe('HNWhoisHiring-AcmeLtd-BackendEnginee');
  });

  it('flags a posting older than 30 days', () => {
    const old = new Date(Date.now() - 45 * 86400000).toISOString();
    const fresh = new Date(Date.now() - 3 * 86400000).toISOString();
    expect(isStale(old)).toBe(true);
    expect(isStale(fresh)).toBe(false);
    expect(isStale(null)).toBe(false);
  });
});

describe('x-ray searches', () => {
  it('quotes the phrases so Google does not widen them', () => {
    const url = xray('naukri.com', 'full stack developer', ['react', 'node'], 'Bengaluru');
    const q = decodeURIComponent(new URL(url).searchParams.get('q'));
    expect(q).toContain('site:naukri.com');
    expect(q).toContain('"full stack developer"');
    expect(q).toContain('"react" OR "node"');
    expect(q).toContain('"Bengaluru"');
  });

  it('leaves the location off a remote search', () => {
    const q = decodeURIComponent(new URL(xray('weworkremotely.com', 'backend developer', ['node'], '')).searchParams.get('q'));
    expect(q).not.toContain('""');
  });
});
