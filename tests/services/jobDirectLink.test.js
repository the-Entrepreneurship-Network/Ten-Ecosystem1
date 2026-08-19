'use strict';

/**
 * url-rules.md as tests: the link must be the job, never the board home,
 * never a search page — and when only the board listing is live, that is
 * said rather than papered over.
 */

const {
  classify, isSearchPage, extractApplyLink, resolveDirectUrl
} = require('../../services/v2/jobDirectLink');

describe('classifying URLs', () => {
  it.each([
    ['https://boards.greenhouse.io/acme/jobs/123456', 'ats'],
    ['https://jobs.lever.co/acme/abc-def', 'ats'],
    ['https://acme.wd1.myworkdayjobs.com/en-US/careers/job/123', 'ats'],
    ['https://careers.acme.com/openings/backend-engineer', 'company'],
    ['https://remotive.com/remote-jobs/software-dev/backend-123', 'board'],
    ['https://www.linkedin.com/jobs/view/999', 'board'],
  ])('%s → %s', (url, expected) => {
    expect(classify(url)).toBe(expected);
  });

  it('a search page is never an opening', () => {
    expect(isSearchPage('https://www.google.com/search?q=backend+jobs')).toBe(true);
    expect(classify('https://www.google.com/search?q=backend+jobs')).toBeNull();
    expect(isSearchPage('https://in.indeed.com/jobs?q=react&l=Pune')).toBe(true);
  });
});

describe('extracting the apply link from a board page', () => {
  const BOARD = 'https://remotive.com/remote-jobs/dev/backend-123';

  it('prefers the ATS link over everything else', () => {
    const html = `
      <a href="https://twitter.com/acme">tweet</a>
      <a href="https://acme.com/about">about</a>
      <a href="https://boards.greenhouse.io/acme/jobs/7788">Apply</a>`;
    const found = extractApplyLink(html, BOARD);
    expect(found.kind).toBe('ats');
    expect(found.url).toContain('greenhouse.io/acme/jobs/7788');
  });

  it('falls back to the employer careers page', () => {
    const html = '<a href="https://careers.acme.com/jobs/backend-engineer-pune">Apply here</a>';
    const found = extractApplyLink(html, BOARD);
    expect(found.kind).toBe('company');
  });

  it('a privacy notice under /careers/ is not a job — nor is any document download', () => {
    // A live run shipped a recruitment-privacy PDF as "the opening".
    const html = `
      <a href="https://www.baringa.com/globalassets/careers/dp-004-privacy-notice.pdf">notice</a>
      <a href="https://acme.com/careers/terms-and-conditions">terms</a>`;
    expect(extractApplyLink(html, BOARD)).toBeNull();
  });

  it('never returns a login wall or another aggregator', () => {
    const html = `
      <a href="https://acme.com/login">sign in</a>
      <a href="https://www.linkedin.com/jobs/view/1">also on linkedin</a>`;
    expect(extractApplyLink(html, BOARD)).toBeNull();
  });
});

describe('resolving one listing', () => {
  it('keeps an already-direct URL without fetching anything', async () => {
    const fetcher = jest.fn();
    const out = await resolveDirectUrl(
      { url: 'https://boards.greenhouse.io/acme/jobs/1' }, { fetch: fetcher });
    expect(out.kind).toBe('ats');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('captures a redirect that leaves the board', async () => {
    const fetcher = jest.fn().mockResolvedValue({
      ok: true, url: 'https://jobs.lever.co/acme/xyz', text: async () => ''
    });
    const out = await resolveDirectUrl({ url: 'https://remoteok.com/l/999' }, { fetch: fetcher });
    expect(out.kind).toBe('ats');
    expect(out.url).toContain('lever.co');
  });

  it('reads the page when the redirect stays on the board', async () => {
    const fetcher = jest.fn().mockResolvedValue({
      ok: true, url: 'https://remotive.com/remote-jobs/dev/1',
      text: async () => '<a href="https://boards.greenhouse.io/acme/jobs/5">Apply</a>'
    });
    const out = await resolveDirectUrl({ url: 'https://remotive.com/remote-jobs/dev/1' }, { fetch: fetcher });
    expect(out.kind).toBe('ats');
  });

  it('answers null honestly when nothing can be proven', async () => {
    const fetcher = jest.fn().mockResolvedValue({
      ok: true, url: 'https://remotive.com/remote-jobs/dev/1', text: async () => 'no links here'
    });
    const out = await resolveDirectUrl({ url: 'https://remotive.com/remote-jobs/dev/1' }, { fetch: fetcher });
    expect(out).toBeNull();
  });
});

describe('the HR application email', () => {
  const { hrEmail } = require('../../services/v2/jobMaterials');
  const RESUME = [
    'Asha Menon', '', 'Experience',
    'Built a booking platform in React and Node handling 4000 users a month.',
    '', 'Education', 'B.Tech Computer Science, 2022'
  ].join('\n');
  const PROFILE = { name: 'Asha Menon', role: 'full stack developer', skills: ['react', 'node'], education: 'B.Tech CSE', location: 'Bengaluru' };
  const JOB = { title: 'Full Stack Developer', company: 'Northwind', url: 'https://boards.greenhouse.io/northwind/jobs/1', description: 'React and Node.', tags: [] };

  it('follows the email-hr shape: subject, URL first, evidence, one ask', () => {
    const mail = hrEmail(PROFILE, JOB, RESUME, {});
    expect(mail.subject).toBe('Application for Full Stack Developer — Asha Menon');
    expect(mail.body.split('\n')[0]).toContain(JOB.url);
    expect(mail.body).toMatch(/4000 users/);
    expect(mail.body).toMatch(/15-minute call/);
    expect(mail.withinShape).toBe(true);
  });

  it('never guesses the recipient address', () => {
    const mail = hrEmail(PROFILE, JOB, RESUME, {});
    expect(mail.to).toBe('');
    expect(mail.toNote).toMatch(/not guessed/);
  });

  it('avoids the banned phrasings', () => {
    expect(hrEmail(PROFILE, JOB, RESUME, {}).clichesAvoided).toBe(true);
  });
});
