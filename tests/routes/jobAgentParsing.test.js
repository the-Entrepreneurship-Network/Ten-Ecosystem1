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

describe('reading the role a resume is aiming at', () => {
  const roleOf = (lines) => profileFromResume(lines.join('\n')).role;

  it('does not call an HR resume a software engineer', () => {
    /* It listed recruitment, onboarding, HRIS and payroll, was labelled a
       software engineer, and was then handed a maintenance job. */
    expect(roleOf(['Neha Rao', 'neha@example.com', '', 'Experience',
      'Ran campus recruitment and onboarding for 60 hires.', '',
      'Skills', 'Recruitment, Onboarding, HRIS, Payroll'])).toBe('hr executive');
  });

  it.each([
    [['Skills', 'Docker, Kubernetes, Terraform, Jenkins, AWS'], 'devops engineer'],
    [['Skills', 'SQL, Tableau, Power BI, pandas'], 'data analyst'],
    [['Skills', 'React, Node, MongoDB, Express'], 'full stack developer'],
  ])('reads %j as %s', (skills, expected) => {
    expect(roleOf(['A Person', 'a@example.com', '', 'Experience',
      'Delivered projects end to end.', '', ...skills])).toBe(expected);
  });
});

describe('how fresh a recruiter contact is', () => {
  const { ageOfContact, RECRUITER_MAX_DAYS } = agent;
  const ago = (ms) => new Date(Date.now() - ms).toISOString();

  it('counts in hours, days and weeks — never months', () => {
    expect(ageOfContact(ago(30 * 60 * 1000)).label).toBe('just now');
    expect(ageOfContact(ago(2 * 3600 * 1000)).label).toBe('2 hours ago');
    expect(ageOfContact(ago(26 * 3600 * 1000)).label).toBe('1 day ago');
    expect(ageOfContact(ago(3 * 86400 * 1000)).label).toBe('3 days ago');
    expect(ageOfContact(ago(9 * 86400 * 1000)).label).toBe('1 week ago');
    expect(ageOfContact(ago(21 * 86400 * 1000)).label).toBe('3 weeks ago');
  });

  it('never says months, even at the edge of the window', () => {
    for (const days of [35, 41, 42]) {
      expect(ageOfContact(ago(days * 86400 * 1000)).label).not.toMatch(/month/i);
    }
  });

  it('stops at six weeks — a contact goes cold long before a posting does', () => {
    expect(RECRUITER_MAX_DAYS).toBe(42);
    expect(ageOfContact(ago(50 * 86400 * 1000)).days).toBeGreaterThan(RECRUITER_MAX_DAYS);
  });

  it('says nothing rather than guessing when the date is unusable', () => {
    expect(ageOfContact(null).label).toBe('');
    expect(ageOfContact('not a date').label).toBe('');
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
