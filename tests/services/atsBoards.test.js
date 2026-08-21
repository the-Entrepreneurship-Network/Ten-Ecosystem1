'use strict';

/**
 * Company ATS boards. The property that matters: every row arrives with the
 * employer's own URL already attached, so a direct link is the data rather
 * than something resolved afterwards.
 */

const boards = require('../../services/v2/atsBoards');

describe('reading a company board', () => {
  const withFetch = (payload) => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => payload });
  };
  afterEach(() => { delete global.fetch; });

  it('greenhouse rows carry the employer posting URL', async () => {
    withFetch({ jobs: [{
      title: 'Backend Engineer', absolute_url: 'https://boards.greenhouse.io/acme/jobs/123',
      location: { name: 'Bengaluru' }, updated_at: '2026-08-01T00:00:00Z', content: 'Java and Spring Boot'
    }] });
    const rows = await boards.fromGreenhouse('acme');
    expect(rows[0].directUrl).toBe('https://boards.greenhouse.io/acme/jobs/123');
    expect(rows[0].directKind).toBe('ats');
    expect(rows[0].source).toBe('Greenhouse');
  });

  it('lever rows carry the hosted posting URL', async () => {
    withFetch([{ text: 'Data Analyst', hostedUrl: 'https://jobs.lever.co/acme/xyz',
      categories: { location: 'Remote', commitment: 'Full-time', team: 'Data' }, createdAt: 1750000000000 }]);
    const rows = await boards.fromLever('acme');
    expect(rows[0].directUrl).toContain('jobs.lever.co');
    expect(rows[0].directKind).toBe('ats');
  });

  it('ashby rows carry the job URL', async () => {
    withFetch({ jobs: [{ title: 'Platform Engineer', jobUrl: 'https://jobs.ashbyhq.com/acme/abc',
      location: 'Remote', companyName: 'Acme', publishedAt: '2026-08-10' }] });
    const rows = await boards.fromAshby('acme');
    expect(rows[0].directUrl).toContain('jobs.ashbyhq.com');
  });

  it('a board that 404s contributes nothing rather than failing the hunt', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 404, json: async () => ({}) });
    const found = await boards.huntBoards(() => true, { budgetMs: 500, perBoard: 1 });
    expect(Array.isArray(found)).toBe(true);
    expect(found).toHaveLength(0);
  });

  it('only rows matching the profile come back', async () => {
    withFetch({ jobs: [
      { title: 'Backend Engineer', absolute_url: 'https://boards.greenhouse.io/a/jobs/1', location: { name: 'X' }, content: '' },
      { title: 'Warehouse Associate', absolute_url: 'https://boards.greenhouse.io/a/jobs/2', location: { name: 'X' }, content: '' },
    ] });
    const found = await boards.huntBoards((r) => /engineer/i.test(r.title), { budgetMs: 2000, perBoard: 1 });
    expect(found.every((r) => /engineer/i.test(r.title))).toBe(true);
  });
});

describe('the DOCX export', () => {
  const { resumeDocxBuffer } = require('../../services/v2/resumeDocx');

  it('produces a real Word file', async () => {
    const buf = await resumeDocxBuffer(['ASHA MENON', 'Backend Developer', 'asha@example.com', '',
      'SUMMARY', 'Backend developer.', '', 'EXPERIENCE', '- Built REST APIs in Spring Boot'].join('\n'));
    expect(buf.length).toBeGreaterThan(2000);
    /* Every .docx is a zip: the signature is the cheapest proof it is one. */
    expect(buf.slice(0, 2).toString()).toBe('PK');
  });
});
